import * as vscode from 'vscode';
import { DocsSite, isIgnoredMkdocs, isShownSite, siteFromMkdocs, siteOf } from './docsSite';

const MKDOCS = '**/mkdocs.{yml,yaml}';
const MKDOCS_NAMES = ['mkdocs.yml', 'mkdocs.yaml'];
const IGNORED = ['**/node_modules/**', '**/.*/**'];

/** O que a busca pula: as pastas que nunca têm sites e o `files.exclude` do VS Code (ignorado ao passar uma lista). */
function excludeGlob() {
  const excluded = vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude') ?? {};
  const fromSettings = Object.entries(excluded)
    .filter(([, on]) => on === true)
    .flatMap(([glob]) => [glob, `${glob}/**`]);
  return `{${[...IGNORED, ...fromSettings].join(',')}}`;
}

/** Até quantas pastas abaixo da pasta do workspace a busca acha os sites (`techdocsEditor.siteDepth`). */
export function siteDepth(): number {
  const depth = vscode.workspace.getConfiguration('techdocsEditor').get<number>('siteDepth');
  return typeof depth === 'number' && depth >= 0 ? Math.floor(depth) : 2;
}

/** Quantas pastas o site está abaixo de `base` (0: o `mkdocs.yml` está nela). */
export function depthBelow(mkdocsPath: string, base: string): number {
  const rest = mkdocsPath.slice(base.replace(/\/$/, '').length + 1);
  return rest.split('/').length - 1;
}

/**
 * Sites do MkDocs do workspace (modo local, spec 02 LC1): os `mkdocs.yml` achados, com o `docs_dir`
 * de cada um. Acompanha a criação, a mudança e a remoção dos arquivos.
 *
 * A busca vai só até `techdocsEditor.siteDepth` pastas abaixo da pasta do workspace (padrão 2): aberto em `~/code`,
 * os repositórios e as subpastas deles, sem os sites de repositórios dentro de outros nem as fixtures de teste.
 * Os mais fundos entram quando a pessoa chega neles: ao abrir uma página deles (`discoverFor`) ou ao entrar na
 * pasta pela troca de diretório (`discover`).
 */
export class LocalSites implements vscode.Disposable {
  /** Por `mkdocs.yml`; `origin` separa sites de esquemas diferentes (disco, vscode-vfs…). */
  private sites = new Map<string, { origin: string; site: DocsSite }>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Os sites mudaram (um `mkdocs.yml` criado, alterado ou removido). */
  readonly onDidChange = this.changeEmitter.event;
  /** Primeira busca no workspace concluída. */
  readonly ready: Promise<void>;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(MKDOCS);
    const folders = vscode.workspace.createFileSystemWatcher('**/*', true, true, false);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(uri => this.withinDepth(uri) && this.read(uri)),
      watcher.onDidChange(uri => (this.sites.has(uri.toString()) || this.withinDepth(uri)) && this.read(uri)),
      watcher.onDidDelete(uri => {
        if (this.sites.delete(uri.toString())) this.changeEmitter.fire();
      }),
      // Pasta apagada: o VS Code avisa só a pasta, não o `mkdocs.yml` de dentro
      folders,
      folders.onDidDelete(folder => {
        const inside = [...this.sites.keys()].filter(key => key.startsWith(`${folder.toString()}/`));
        inside.forEach(key => this.sites.delete(key));
        if (inside.length) this.changeEmitter.fire();
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('files.exclude') || e.affectsConfiguration('techdocsEditor.siteDepth')) void this.scan(true);
        else if (e.affectsConfiguration('techdocsEditor.sites')) this.changeEmitter.fire();
      }),
      // Página de um site mais fundo que o limite: o site entra ao abri-la
      vscode.workspace.onDidOpenTextDocument(document => void this.discoverFor(document.uri)),
      this.changeEmitter,
    );
    this.ready = this.scan().then(() => Promise.all(vscode.workspace.textDocuments.map(d => this.discoverFor(d.uri)))).then(() => undefined);
  }

  /** Os sites escolhidos em `techdocsEditor.sites` (todos, sem escolha), na ordem dos caminhos. */
  list(): { mkdocs: vscode.Uri; site: DocsSite }[] {
    const chosen = this.chosen();
    return this.all().filter(({ mkdocs, site }) => isShownSite(sitePath(mkdocs.with({ path: site.root })), chosen));
  }

  /** O que está em `techdocsEditor.sites`: null se a pessoa nunca escolheu. */
  chosen(): string[] | null {
    return vscode.workspace.getConfiguration('techdocsEditor').get<string[] | null>('sites') ?? null;
  }

  /** Todos os sites achados, escolhidos ou não, com o `mkdocs.yml` de cada um, na ordem dos caminhos. */
  all(): { mkdocs: vscode.Uri; site: DocsSite }[] {
    return [...this.sites.entries()]
      .map(([key, { site }]) => ({ mkdocs: vscode.Uri.parse(key), site }))
      .sort((a, b) => a.site.root.localeCompare(b.site.root));
  }

  /** Site da página, ou undefined se ela não está no `docs_dir` de nenhum `mkdocs.yml`. */
  siteOf(uri: vscode.Uri): DocsSite | undefined {
    const sameOrigin = [...this.sites.values()].filter(s => s.origin === originOf(uri)).map(s => s.site);
    return siteOf(uri.path, sameOrigin);
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  /**
   * Os sites dentro da pasta, até `techdocsEditor.siteDepth` pastas abaixo dela (a troca de diretório, ao entrar
   * numa pasta mais funda que o limite da busca do workspace). Avisa se achou algum novo.
   */
  async discover(folder: vscode.Uri): Promise<void> {
    const depth = siteDepth();
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, MKDOCS), excludeGlob());
    const added = await Promise.all(
      found.filter(uri => !this.sites.has(uri.toString()) && depthBelow(uri.path, folder.path) <= depth).map(uri => this.read(uri, false)),
    );
    if (added.some(Boolean)) this.changeEmitter.fire();
  }

  /**
   * O site de um `.md` do workspace que nenhum site conhecido tem (mais fundo que o limite da busca): sobe as
   * pastas até a do workspace procurando o `mkdocs.yml`. Avisa se achou.
   */
  async discoverFor(uri: vscode.Uri): Promise<void> {
    if (!/\.md$/i.test(uri.path) || this.siteOf(uri)) return;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const top = folder.uri.path.replace(/\/$/, '');
    for (let dir = uri.path.slice(0, uri.path.lastIndexOf('/')); dir.length > top.length; dir = dir.slice(0, dir.lastIndexOf('/'))) {
      for (const name of MKDOCS_NAMES) {
        const mkdocs = uri.with({ path: `${dir}/${name}` });
        if (await exists(mkdocs)) {
          if (!this.sites.has(mkdocs.toString())) await this.read(mkdocs);
          return;
        }
      }
    }
  }

  /** O `mkdocs.yml` está até `techdocsEditor.siteDepth` pastas abaixo da pasta do workspace. */
  private withinDepth(mkdocs: vscode.Uri): boolean {
    const folder = vscode.workspace.getWorkspaceFolder(mkdocs);
    return !folder || depthBelow(mkdocs.path, folder.uri.path) <= siteDepth();
  }

  private async scan(again = false) {
    if (again) this.sites.clear();
    const found = await vscode.workspace.findFiles(MKDOCS, excludeGlob());
    await Promise.all(found.filter(uri => this.withinDepth(uri)).map(uri => this.read(uri, false)));
    this.changeEmitter.fire();
  }

  /** O site acabado de criar: entra já, sem esperar o observador (que atrasa num workspace grande, como o ~). */
  async add(mkdocs: vscode.Uri): Promise<void> {
    await this.read(mkdocs);
  }

  /** Tira o site cujo `mkdocs.yml` sumiu sem o observador avisar (sem disparar a mudança: quem chama está montando). */
  forget(mkdocs: vscode.Uri) {
    this.sites.delete(mkdocs.toString());
  }

  /** Lê o `mkdocs.yml`; true se o site entrou (ou mudou). */
  private async read(uri: vscode.Uri, notify = true): Promise<boolean> {
    let text = '';
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      // Lido entre a criação e a gravação, ou removido: o observador avisa de novo
      return false;
    }
    if (isIgnoredMkdocs(vscode.workspace.asRelativePath(uri, false), text)) return false;
    this.sites.set(uri.toString(), { origin: originOf(uri), site: siteFromMkdocs(uri.path, text) });
    if (notify) this.changeEmitter.fire();
    return true;
  }
}

/** Pasta do site relativa à pasta do workspace (`.` na raiz), como em `techdocsEditor.sites`. */
export function sitePath(root: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(root);
  if (!folder) return root.path;
  return root.path.slice(folder.uri.path.replace(/\/$/, '').length + 1) || '.';
}

const originOf = (uri: vscode.Uri) => `${uri.scheme}://${uri.authority}`;

const exists = (uri: vscode.Uri) => Promise.resolve(vscode.workspace.fs.stat(uri)).then(() => true, () => false);
