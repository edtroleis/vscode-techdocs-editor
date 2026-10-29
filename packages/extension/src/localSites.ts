import * as vscode from 'vscode';
import { DocsSite, isIgnoredMkdocs, isShownSite, siteFromMkdocs, siteOf } from './docsSite';

const MKDOCS = '**/mkdocs.{yml,yaml}';
const IGNORED = ['**/node_modules/**', '**/.*/**'];

/** O que a busca pula: as pastas que nunca têm sites e o `files.exclude` do VS Code (ignorado ao passar uma lista). */
function excludeGlob() {
  const excluded = vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude') ?? {};
  const fromSettings = Object.entries(excluded)
    .filter(([, on]) => on === true)
    .flatMap(([glob]) => [glob, `${glob}/**`]);
  return `{${[...IGNORED, ...fromSettings].join(',')}}`;
}

/**
 * Sites do MkDocs do workspace (modo local, spec 02 LC1): os `mkdocs.yml` achados, com o `docs_dir`
 * de cada um. Acompanha a criação, a mudança e a remoção dos arquivos.
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
      watcher.onDidCreate(uri => this.read(uri)),
      watcher.onDidChange(uri => this.read(uri)),
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
        if (e.affectsConfiguration('files.exclude')) void this.scan(true);
        else if (e.affectsConfiguration('techdocsEditor.sites')) this.changeEmitter.fire();
      }),
      this.changeEmitter,
    );
    this.ready = this.scan();
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

  private async scan(again = false) {
    if (again) this.sites.clear();
    const found = await vscode.workspace.findFiles(MKDOCS, excludeGlob());
    await Promise.all(found.map(uri => this.read(uri, false)));
    this.changeEmitter.fire();
  }

  private async read(uri: vscode.Uri, notify = true) {
    let text = '';
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      // Lido entre a criação e a gravação, ou removido: o observador avisa de novo
      return;
    }
    if (isIgnoredMkdocs(vscode.workspace.asRelativePath(uri, false), text)) return;
    this.sites.set(uri.toString(), { origin: originOf(uri), site: siteFromMkdocs(uri.path, text) });
    if (notify) this.changeEmitter.fire();
  }
}

/** Pasta do site relativa à pasta do workspace (`.` na raiz), como em `techdocsEditor.sites`. */
export function sitePath(root: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(root);
  if (!folder) return root.path;
  return root.path.slice(folder.uri.path.replace(/\/$/, '').length + 1) || '.';
}

const originOf = (uri: vscode.Uri) => `${uri.scheme}://${uri.authority}`;
