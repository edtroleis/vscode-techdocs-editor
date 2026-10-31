import * as vscode from 'vscode';
import { dirOf, DocsNode, DocsTree, docsTree, loadRemoteSiteTree, pageTitle, parseRemoteUri, relativePath, REMOTE_SCHEME, siteName } from '@edtroleis/techdocs-editor-core';
import { repoDirOf, repoOf } from './chooseSites';
import type { DocsSite } from './docsSite';
import type { LintService } from './lintService';
import type { LocalSites } from './localSites';
import type { LinkPageView } from './protocol';
import { invalidatePages, pickSite, RECENT_COUNT } from './sitePicker';
import { remoteUri } from './remote/remoteFs';
import { type RemoteEntry, type RemoteRepos, SignInRequiredError } from './remote/remoteRepos';

export const DOCS_VIEW = 'techdocsEditor.docs';
const REFRESH_DELAY_MS = 300;
/** Site escolhido no seletor, por workspace. */
const CURRENT_KEY = 'techdocsEditor.currentSite';
/** Os últimos sites mostrados, o mais recente primeiro. */
const RECENT_KEY = 'techdocsEditor.recentSites';
/** A visão da árvore, por workspace: os arquivos do `docs_dir` ou o menu do site. */
const MODE_KEY = 'techdocsEditor.treeMode';

/** `files`: as pastas e os `.md` do `docs_dir`, pelo nome do arquivo; `menu`: o menu do site, pelos títulos. */
export type TreeMode = 'files' | 'menu';

/** Um rascunho de "Minhas alterações", para marcar o site dele na lista. */
export type DraftRef = { state: 'draft' | 'review'; uris: vscode.Uri[] };

/** Um site que o seletor oferece: do workspace (`local`) ou aberto do GitHub (`remote`). */
export type SiteCandidate = {
  /** O `mkdocs.yml` do site local, ou `remote:host/dono/repo/pasta`. */
  key: string;
  label: string;
  /** A pasta do site no workspace, ou `dono/repo/pasta` no GitHub. */
  description: string;
  /** Agrupa a lista: o repositório Git da pasta, ou `host/dono/repo`. */
  repo: string;
  /** A linha da pasta no topo da árvore: o repositório (`repo-x`, `dono/repo`) e, num site de subpasta, `› pasta`. */
  place: string;
  local?: { mkdocs: vscode.Uri; site: DocsSite; yml: string | undefined };
  remote?: RemoteEntry;
};

/** Testes de integração: o site escolhido na lista (a chave; undefined = cancelar). */
let testSitePick: ((candidates: SiteCandidate[]) => string | undefined) | undefined;
export function useTestSitePick(pick: typeof testSitePick) {
  testSitePick = pick;
}

/**
 * Item da árvore: o site mostrado (`site`, ou `remote` do GitHub: a linha da pasta, no topo, e o clique troca),
 * uma seção, uma pasta do `docs_dir` (`dir`, na visão dos arquivos), uma página, um link do `nav` ou o aviso de
 * que o site do GitHub não pôde ser lido (`remoteError`).
 */
export class DocsItem {
  readonly children: DocsItem[] = [];
  /** O site do GitHub do item `remote` (para fechar e ler de novo). */
  remote?: RemoteEntry;
  /** Pasta do `mkdocs.yml` do item `site` (para esconder). */
  siteRoot?: vscode.Uri;
  /** Página: o caminho no `docs_dir`. */
  path?: string;
  /** Seção: os títulos desde a raiz do menu, até ela. */
  trail?: string[];
  /** A página inicial do site (`index.md` na raiz): não sai do topo nem é excluída. */
  home?: boolean;
  /** Página fora do `nav` (no grupo "Fora do menu"). */
  outside?: boolean;
  /** Item de um site do workspace (dá para excluir, mover e renomear); os do GitHub, por enquanto, não. */
  local?: boolean;
  /** Site: a pasta, como a linha do topo mostra (`repo`, `repo › subpasta`, `dono/repo`). */
  place?: string;
  /** Página com o título escrito no `nav`: mudar o título 1 da página não muda o menu. */
  fixedTitle?: boolean;
  /** Página na visão dos arquivos: aparece pelo nome do arquivo (o `label` continua o título). */
  file?: boolean;
  constructor(
    readonly kind: 'site' | 'remote' | 'remoteError' | 'section' | 'dir' | 'page' | 'missing' | 'link' | 'notInNav',
    readonly label: string,
    readonly parent: DocsItem | undefined,
    /** Página ou arquivo do link (link externo: o endereço). */
    readonly uri?: vscode.Uri,
    readonly description?: string,
  ) {}
}

/**
 * Árvore "Documentação" (spec 02, LC6): as páginas do site escolhido, pelo `nav` do `mkdocs.yml` ou pelas
 * pastas. Com mais de um site (no workspace ou abertos do GitHub), um de cada vez: a linha da pasta no topo tem
 * o "Trocar", e abrir uma página de outro site troca sozinho; sem nenhum escolhido, a tela pede a escolha.
 * Clicar abre a página como o resto do VS Code (ou no visual, com `techdocsEditor.openVisualByDefault`); a
 * página aberta fica selecionada na árvore.
 */
export class DocsTreeView implements vscode.TreeDataProvider<DocsItem>, vscode.Disposable {
  private roots: DocsItem[] = [];
  private pages = new Map<string, DocsItem>();
  private readonly changeEmitter = new vscode.EventEmitter<DocsItem[] | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly view: vscode.TreeView<DocsItem>;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly diagnosed = new Set<string>();
  private runs = 0;
  private latest: Promise<void> = Promise.resolve();
  /** Última montagem da árvore (os testes esperam por ela). */
  ready: Promise<void> = Promise.resolve();
  /** Os sites do seletor, da última montagem. */
  private candidates: SiteCandidate[] = [];
  private currentKey: string | undefined;
  private readonly statusItem = vscode.window.createStatusBarItem('techdocsEditor.currentSite', vscode.StatusBarAlignment.Left, 49);
  private drafts: () => readonly DraftRef[] = () => [];
  /** Página aberta de outro site, ainda por seguir (o site dela pode entrar na lista só na próxima montagem). */
  private follow: vscode.Uri | undefined;
  private treeMode: TreeMode;

  constructor(
    private readonly sites: LocalSites,
    private readonly remotes: RemoteRepos,
    private readonly state?: vscode.Memento,
    dragAndDropController?: vscode.TreeDragAndDropController<DocsItem>,
    /** Problemas de formatação da página: a dica do ⚠ diz se há ajuste automático. */
    private readonly lint?: Pick<LintService, 'problems'>,
  ) {
    this.currentKey = state?.get<string>(CURRENT_KEY);
    this.treeMode = state?.get<TreeMode>(MODE_KEY) === 'menu' ? 'menu' : 'files';
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.treeMode', this.treeMode);
    // Ao abrir o VS Code, o site da página que estava aberta
    this.follow = activeUri();
    this.view = vscode.window.createTreeView(DOCS_VIEW, { treeDataProvider: this, showCollapseAll: true, dragAndDropController, canSelectMany: false });
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    // Pasta apagada (ou renomeada): o VS Code avisa só a pasta, não os `.md` de dentro
    const deletions = vscode.workspace.createFileSystemWatcher('**/*', true, true, false);
    const later = () => this.refreshLater();
    this.statusItem.name = vscode.l10n.t('Current documentation');
    this.statusItem.command = 'techdocsEditor.chooseSite';
    this.disposables.push(
      this.view,
      this.statusItem,
      this.changeEmitter,
      watcher,
      watcher.onDidCreate(later),
      watcher.onDidDelete(later),
      // O título da página vem do título 1: mudou ao salvar
      watcher.onDidChange(later),
      deletions,
      deletions.onDidDelete(later),
      sites.onDidChange(later),
      remotes.onDidChange(later),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        this.followActive();
        this.revealActive();
      }),
      this.view.onDidChangeVisibility(() => this.revealActive()),
      // O ⚠ das páginas acompanha os problemas de formatação
      // Só as páginas que mudaram: redesenhar a árvore toda perde a seleção
      vscode.languages.onDidChangeDiagnostics(e => {
        e.uris.forEach(uri => this.diagnosed.add(uri.toString()));
        clearTimeout(this.diagnosticsTimer);
        this.diagnosticsTimer = setTimeout(() => {
          const items = [...this.diagnosed].map(uri => this.pages.get(uri)).filter((i): i is DocsItem => i !== undefined);
          this.diagnosed.clear();
          if (items.length) this.changeEmitter.fire(items);
        }, REFRESH_DELAY_MS);
      }),
    );
    this.ready = sites.ready.then(() => this.refresh());
  }

  getTreeItem(item: DocsItem): vscode.TreeItem {
    const collapsible = item.children.length
      ? (item.kind === 'site' || item.kind === 'remote') && !item.parent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const label = item.file ? item.uri!.path.split('/').pop()! : (item.place ?? item.label);
    const tree = new vscode.TreeItem(label, collapsible);
    tree.description = item.description;
    // `page local home`: os menus e os atalhos olham as palavras
    tree.contextValue = [item.kind, item.local && 'local', item.home && 'home', item.outside && 'outside', item.fixedTitle && 'fixedTitle', item.file && 'file']
      .filter(Boolean)
      .join(' ');
    switch (item.kind) {
      case 'page': {
        // Sem o número de problemas do VS Code ao lado: um ⚠ com a explicação na dica
        const problems = vscode.languages.getDiagnostics(item.uri!).filter(d => d.severity <= vscode.DiagnosticSeverity.Warning).length;
        tree.iconPath = problems ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')) : new vscode.ThemeIcon('markdown');
        const where = item.uri!.scheme === REMOTE_SCHEME ? item.path : vscode.workspace.asRelativePath(item.uri!);
        // Na visão dos arquivos, a dica diz o título da página (e se ela está fora do menu)
        const about = item.file ? [item.label, where, item.outside && vscode.l10n.t('Not in the menu of the site')].filter(Boolean).join('\n') : where;
        const fix = problems ? problemsTooltip(problems, this.lint?.problems(item.uri!).filter(p => p.fixable).length ?? 0) : undefined;
        tree.tooltip = !fix ? about : item.file ? `${about}\n${fix}` : fix;
        // Clicar abre no editor visual
        tree.command = { command: 'techdocsEditor.openVisual', title: vscode.l10n.t('Open'), arguments: [item.uri] };
        break;
      }
      case 'section':
        if (!item.children.length) {
          tree.description = vscode.l10n.t('empty');
          tree.tooltip = vscode.l10n.t('A section without pages does not appear on the site');
        }
        break;
      case 'missing':
        tree.iconPath = new vscode.ThemeIcon('warning');
        tree.tooltip = vscode.l10n.t('The nav in mkdocs.yml points to a page that does not exist: {0}. Right-click to create the page or remove it from the menu.', item.description!);
        break;
      case 'link':
        tree.iconPath = new vscode.ThemeIcon('link-external');
        tree.tooltip = item.uri!.toString(true);
        tree.command = { command: 'vscode.open', title: vscode.l10n.t('Open'), arguments: [item.uri] };
        break;
      case 'notInNav':
        tree.iconPath = new vscode.ThemeIcon('eye-closed');
        tree.description = String(item.children.length);
        tree.tooltip = vscode.l10n.t('Pages of the site that do not appear in its menu. Add them to the menu or delete them.');
        break;
      case 'dir':
        tree.iconPath = vscode.ThemeIcon.Folder;
        tree.tooltip = item.uri!.scheme === REMOTE_SCHEME ? item.path : vscode.workspace.asRelativePath(item.uri!);
        break;
      // O site é a linha da pasta: onde se está trabalhando; o clique troca (o nome do site fica na dica)
      case 'site':
      case 'remote': {
        tree.iconPath = new vscode.ThemeIcon(item.kind === 'remote' ? 'github' : 'folder-opened');
        tree.description = undefined;
        const where = item.kind === 'remote' ? vscode.l10n.t('Read from GitHub: {0}', item.description!) : item.siteRoot?.fsPath;
        tree.tooltip = [item.label, where, vscode.l10n.t('Click to switch the documentation.')].filter(Boolean).join('\n');
        tree.command = { command: 'techdocsEditor.chooseSite', title: vscode.l10n.t('Switch documentation') };
        break;
      }
      case 'remoteError':
        tree.iconPath = new vscode.ThemeIcon('warning');
        tree.tooltip = item.label;
        break;
    }
    return tree;
  }

  getChildren(item?: DocsItem): DocsItem[] {
    return item ? item.children : this.roots;
  }

  getParent(item: DocsItem): DocsItem | undefined {
    return item.parent;
  }

  /** A seção está aberta na barra lateral (testes). */
  get visible(): boolean {
    return this.view.visible;
  }

  /** Os sites que o seletor oferece (testes). */
  get siteCandidates(): readonly SiteCandidate[] {
    return this.candidates;
  }

  /** O site mostrado (testes). */
  get current(): string | undefined {
    return this.currentKey;
  }

  /** Mostra o site (a chave de `siteCandidates`). */
  select(key: string): Promise<void> {
    this.follow = undefined;
    this.setCurrent(key);
    this.ready = this.refresh();
    return this.ready;
  }

  /** A visão da árvore: os arquivos ou o menu do site. */
  get mode(): TreeMode {
    return this.treeMode;
  }

  /** Troca a visão (botão da barra da árvore); fica guardada no workspace. */
  setMode(mode: TreeMode): Promise<void> {
    if (mode === this.treeMode) return this.ready;
    this.treeMode = mode;
    void this.state?.update(MODE_KEY, mode);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.treeMode', mode);
    return this.refreshNow();
  }

  /** Os rascunhos de "Minhas alterações" (com o arquivo local e o do GitHub), para marcar os sites na lista. */
  useDrafts(drafts: () => readonly DraftRef[]) {
    this.drafts = drafts;
  }

  /** "Trocar documentação" (ver sitePicker.ts). */
  async chooseSite() {
    await this.ready;
    if (testSitePick) {
      const key = testSitePick([...this.candidates].sort((a, b) => a.repo.localeCompare(b.repo) || a.label.localeCompare(b.label)));
      if (key) await this.select(key);
      return;
    }
    await pickSite({
      candidates: this.candidates,
      currentKey: this.currentKey,
      select: key => this.select(key),
      drafts: () => this.draftsBySite(),
      sites: this.sites,
      remotes: this.remotes,
    });
  }

  /** Quantos rascunhos e pedidos em revisão a pessoa tem em cada site. */
  private draftsBySite() {
    const counts = new Map<string, { draft: number; review: number }>();
    for (const draft of this.drafts()) {
      const key = draft.uris.map(uri => keyOf(this.candidates, this.sites, uri)).find(Boolean);
      if (!key) continue;
      const count = counts.get(key) ?? { draft: 0, review: 0 };
      count[draft.state]++;
      counts.set(key, count);
    }
    return counts;
  }

  /** O item selecionado na árvore (os atalhos de teclado agem nele). */
  selected(): DocsItem | undefined {
    return this.view.selection[0];
  }

  /** O site do workspace mostrado: onde as ações da árvore gravam. */
  get localSite(): { mkdocs: vscode.Uri; docsDir: vscode.Uri; tree: DocsTree } | undefined {
    return this.shownSite;
  }
  private shownSite: { mkdocs: vscode.Uri; docsDir: vscode.Uri; tree: DocsTree } | undefined;

  /** Monta a árvore de novo agora (depois de uma ação), sem esperar o vigia de arquivos. */
  refreshNow(): Promise<void> {
    clearTimeout(this.timer);
    invalidatePages();
    this.ready = this.refresh();
    return this.ready;
  }

  /** Seleciona o item na árvore (depois de criar ou mover). */
  async revealItem(find: (item: DocsItem) => boolean) {
    const walk = (items: DocsItem[]): DocsItem | undefined => {
      for (const item of items) {
        if (find(item)) return item;
        const inner = walk(item.children);
        if (inner) return inner;
      }
      return undefined;
    };
    const item = walk(this.roots);
    if (item) await this.view.reveal(item, { select: true, focus: true, expand: true }).then(undefined, () => {});
  }

  /** Item da página na árvore (testes e "revelar a página aberta"). */
  pageItem(uri: vscode.Uri): DocsItem | undefined {
    return this.pages.get(uri.toString());
  }

  /**
   * As outras páginas do site da página `uri`, na ordem do menu (as fora dele no fim), com o link relativo a ela:
   * a caixa de link do editor visual. Vazio se a página não está na árvore (outro site, ou a árvore ainda montando).
   */
  linkTargets(uri: vscode.Uri): LinkPageView[] {
    let top = this.pageItem(uri);
    while (top?.parent) top = top.parent;
    if (!top) return [];
    const site = top.kind === 'site' || top.kind === 'remote' ? top.children : this.roots;
    const from = dirOf(uri.path);
    const found: LinkPageView[] = [];
    const walk = (items: DocsItem[]) =>
      items.forEach(item => {
        if (item.kind === 'page' && item.uri && item.uri.toString() !== uri.toString()) {
          found.push({
            title: item.label,
            // Espaço no nome do arquivo quebraria o link do Markdown
            href: relativePath(from, item.uri.path).replace(/ /g, '%20'),
            detail: item.path ?? item.uri.path.split('/').pop()!,
            ...(item.parent?.kind === 'section' && { section: item.parent.label }),
            ...(item.outside && { outside: true }),
          });
        }
        walk(item.children);
      });
    walk(site.filter(item => item.kind !== 'notInNav'));
    walk(site.filter(item => item.kind === 'notInNav'));
    return found;
  }

  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.diagnosticsTimer);
    this.disposables.forEach(d => d.dispose());
  }

  private refreshLater() {
    invalidatePages();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.ready = this.refresh();
    }, REFRESH_DELAY_MS);
  }

  /**
   * Leituras de um refresh mais antigo podem terminar depois das de um novo (e pôr de volta um título velho): só
   * o último vale, e quem espera um antigo espera o último.
   */
  private refresh(): Promise<void> {
    const latest = this.build(++this.runs);
    this.latest = latest;
    return latest;
  }

  private async build(run: number): Promise<void> {
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasDocs', this.sites.all().length > 0);
    const remotes = this.remotes.list();
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasRemote', remotes.length > 0);
    const candidates = await this.loadCandidates();
    const pages = new Map<string, DocsItem>();
    // A página aberta de outro site; senão o escolhido; senão o único
    const followed = this.follow && keyOf(candidates, this.sites, this.follow);
    let current = candidates.find(c => c.key === followed) ?? candidates.find(c => c.key === this.currentKey);
    if (!current && candidates.length === 1) current = candidates[0];
    const roots: DocsItem[] = [];
    let shown: typeof this.shownSite;
    if (current?.local) {
      const { mkdocs, site, yml } = current.local;
      const docsDir = mkdocs.with({ path: site.docsDir });
      const parent = new DocsItem('site', current.label, undefined, docsDir, current.description);
      parent.siteRoot = mkdocs.with({ path: site.root });
      parent.local = true;
      parent.place = current.place;
      const { tree, items } = await this.siteItems(yml, site, docsDir, parent, pages);
      shown = { mkdocs, docsDir, tree };
      parent.children.push(...items);
      roots.push(parent);
    } else if (current?.remote) {
      const item = await this.remoteItem(current.remote, pages);
      item.place = current.place;
      roots.push(item);
    }
    if (run !== this.runs) return this.latest;
    this.candidates = candidates;
    if (followed) this.follow = undefined;
    if (current && current.key !== this.currentKey) this.setCurrent(current.key);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.needsSite', candidates.length > 1 && !current);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.manySites', candidates.length > 1);
    this.roots = roots;
    this.pages = pages;
    this.shownSite = shown;
    // O site atual na barra de status: um clique troca (com mais de um)
    if (current && candidates.length > 1) {
      this.statusItem.text = `$(book) ${current.label}`;
      this.statusItem.tooltip = vscode.l10n.t('Documentation shown in the TechDocs sidebar. Click to switch.');
      this.statusItem.show();
    } else this.statusItem.hide();
    this.changeEmitter.fire();
    this.revealActive();
  }

  /** Os sites do workspace (os escolhidos em `techdocsEditor.sites`) e os abertos do GitHub. */
  private async loadCandidates(): Promise<SiteCandidate[]> {
    const local = await Promise.all(
      this.sites.list().map(async ({ mkdocs, site }): Promise<SiteCandidate> => {
        const yml = await readText(mkdocs);
        const root = mkdocs.with({ path: site.root });
        const repoDir = (await repoDirOf(root)) ?? vscode.workspace.getWorkspaceFolder(root)?.uri ?? root;
        const inRepo = root.path.slice(repoDir.path.replace(/\/$/, '').length + 1);
        const repoName = repoDir.path.replace(/\/$/, '').split('/').pop() || site.root.split('/').pop()!;
        return {
          key: mkdocs.toString(),
          label: usableName(siteName(yml)) ?? site.root.split('/').pop()!,
          description: vscode.workspace.asRelativePath(root),
          repo: await repoOf(root),
          place: inRepo ? `${repoName} › ${inRepo}` : repoName,
          local: { mkdocs, site, yml },
        };
      }),
    );
    const remote = this.remotes.list().map((entry): SiteCandidate => {
      const where = entry.root ? `${entry.slug}/${entry.root}` : entry.slug;
      const place = entry.root ? `${entry.slug} › ${entry.root}` : entry.slug;
      return { key: remoteKey(entry), label: this.remoteNames.get(remoteKey(entry)) ?? where, description: where, repo: `${entry.host}/${entry.slug}`, place, remote: entry };
    });
    return [...local, ...remote];
  }

  /** Nomes dos sites do GitHub, lidos ao montar a árvore deles. */
  private readonly remoteNames = new Map<string, string>();

  private setCurrent(key: string) {
    this.currentKey = key;
    void this.state?.update(CURRENT_KEY, key);
    const recents = this.state?.get<string[]>(RECENT_KEY) ?? [];
    void this.state?.update(RECENT_KEY, [key, ...recents.filter(k => k !== key)].slice(0, RECENT_COUNT * 2));
  }

  /** Página de outro site no editor: o seletor troca para ele (na próxima montagem, que já conhece o site). */
  private followActive() {
    const uri = activeUri();
    if (!uri || (uri.scheme !== REMOTE_SCHEME && !this.sites.siteOf(uri))) return;
    const key = keyOf(this.candidates, this.sites, uri);
    if (key && key === this.currentKey) return;
    this.follow = uri;
    this.refreshLater();
  }

  private async siteItems(yml: string | undefined, site: DocsSite, docsDir: vscode.Uri, parent: DocsItem | undefined, pages: Map<string, DocsItem>) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(docsDir, '**/*.md'));
    // Só as do site (um site dentro do docs_dir de outro fica com as dele)
    const own = files.filter(uri => this.sites.siteOf(uri)?.docsDir === site.docsDir);
    const relative = (uri: vscode.Uri) => uri.path.slice(site.docsDir.length + 1);
    const titles = new Map<string, string | undefined>();
    await Promise.all(own.map(async uri => titles.set(relative(uri), pageTitle((await readText(uri)) ?? ''))));
    const tree = docsTree(yml, [...titles.keys()], path => titles.get(path));
    return { tree, items: (this.treeMode === 'files' ? fileItems : treeItems)(tree, docsDir, parent, pages, true) };
  }

  /** Um site do GitHub: o nó com o nome do site e as páginas da branch principal, ou o aviso se não deu para ler. */
  private async remoteItem(entry: RemoteEntry, pages: Map<string, DocsItem>): Promise<DocsItem> {
    const where = entry.root ? `${entry.slug}/${entry.root}` : entry.slug;
    const item = new DocsItem('remote', where, undefined, remoteUri(entry.host, entry.slug, entry.root), `${where} · ${entry.host}`);
    item.remote = entry;
    try {
      const access = await this.remotes.access(entry.host, entry.slug);
      const site = access.sites.find(s => s.root === entry.root);
      if (!site) {
        item.children.push(new DocsItem('remoteError', vscode.l10n.t('There is no mkdocs.yml in {0} any more', entry.root || '/'), item));
        return item;
      }
      const remote = await loadRemoteSiteTree(access.client, site, access.repo.defaultBranch);
      this.remoteNames.set(remoteKey(entry), site.name);
      const named = new DocsItem('remote', site.name, undefined, item.uri, item.description);
      named.remote = entry;
      named.children.push(...(this.treeMode === 'files' ? fileItems : treeItems)(remote.tree, remoteUri(entry.host, entry.slug, site.docsDir), named, pages, false));
      return named;
    } catch (error) {
      const message =
        error instanceof SignInRequiredError
          ? vscode.l10n.t('Sign in to GitHub to read it (open it again from the GitHub command)')
          : vscode.l10n.t('Could not read it: {0}', error instanceof Error ? error.message : String(error));
      item.children.push(new DocsItem('remoteError', message, item));
      return item;
    }
  }

  /** Seleciona na árvore a página do editor ativo (texto ou visual), como o Explorer faz com o arquivo. */
  private revealActive() {
    if (!this.view.visible) return;
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
    const item = uri && this.pageItem(uri);
    // No editor visual, sem selecionar: a seleção feita daqui tira o foco do webview na primeira edição seguinte, e
    // as letras digitadas se perdem (o clique da própria pessoa na árvore não tem esse problema)
    if (item) void this.view.reveal(item, { select: !(input instanceof vscode.TabInputCustom), focus: false, expand: true }).then(undefined, () => {});
  }
}

/** O arquivo da aba ativa (texto ou editor visual). */
function activeUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

/** O site da página, entre os candidatos. */
function keyOf(candidates: SiteCandidate[], sites: LocalSites, uri: vscode.Uri): string | undefined {
  if (uri.scheme === REMOTE_SCHEME) {
    const ref = parseRemoteUri(uri.authority, uri.path);
    if (!ref) return undefined;
    // O site de pasta mais funda que contém a página
    return candidates
      .filter(c => c.remote && c.remote.host === ref.host && c.remote.slug === ref.slug && (!c.remote.root || ref.path.startsWith(`${c.remote.root}/`)))
      .sort((a, b) => b.remote!.root.length - a.remote!.root.length)[0]?.key;
  }
  const site = sites.siteOf(uri);
  return site && candidates.find(c => c.local?.site.root === site.root)?.key;
}

/** O `site_name`, menos os de esqueleto ("CHANGE-ME", "TODO"…): aí fica o nome da pasta. */
function usableName(name: string | undefined): string | undefined {
  return name && !/^(change[-_ ]?me|todo|tbd|xxx+|site[-_ ]?name|my[-_ ]?docs)$/i.test(name.trim()) ? name : undefined;
}

function remoteKey(entry: RemoteEntry) {
  return `remote:${entry.host}/${entry.slug}/${entry.root}`;
}

/** Itens da árvore de um site (o `nav`, ou as pastas, e as páginas fora do `nav`), com as páginas em `pages`. */
function treeItems(tree: DocsTree, docsDir: vscode.Uri, parent: DocsItem | undefined, pages: Map<string, DocsItem>, local: boolean): DocsItem[] {
  const toItem = (node: DocsNode, under: DocsItem | undefined): DocsItem => {
    const item = toItemOf(node, under);
    item.local = local;
    return item;
  };
  const toItemOf = (node: DocsNode, under: DocsItem | undefined): DocsItem => {
    if (node.kind === 'section') {
      const section = new DocsItem('section', node.title, under);
      section.trail = [...(under?.trail ?? []), node.title];
      section.children.push(...node.children.map(child => toItem(child, section)));
      return section;
    }
    if (node.kind === 'link') {
      const uri = /^[a-z][a-z0-9+.-]*:/i.test(node.url) ? vscode.Uri.parse(node.url) : vscode.Uri.joinPath(docsDir, node.url);
      return new DocsItem('link', node.title, under, uri);
    }
    if (node.missing) return new DocsItem('missing', node.title, under, undefined, node.path);
    const page = new DocsItem('page', node.title, under, vscode.Uri.joinPath(docsDir, node.path));
    page.path = node.path;
    page.fixedTitle = node.fixedTitle;
    page.home = !under?.trail && /^(index|readme)\.md$/i.test(node.path) && under?.kind !== 'notInNav';
    page.outside = under?.kind === 'notInNav';
    pages.set(page.uri!.toString(), page);
    return page;
  };
  const items = tree.nodes.map(node => toItem(node, parent));
  if (tree.notInNav.length) {
    const group = new DocsItem('notInNav', vscode.l10n.t('Not in the menu'), parent);
    group.children.push(...tree.notInNav.map(node => toItem(node, group)));
    items.push(group);
  }
  return items;
}

/**
 * Itens da visão dos arquivos: as pastas e os `.md` do `docs_dir`, como no disco (as pastas primeiro, cada lista em
 * ordem alfabética, como o Explorer), com as páginas em `pages`. Página fora do menu fica marcada (`outside`).
 */
function fileItems(tree: DocsTree, docsDir: vscode.Uri, parent: DocsItem | undefined, pages: Map<string, DocsItem>, local: boolean): DocsItem[] {
  const titles = new Map<string, string>();
  const fixed = new Set<string>();
  const collect = (nodes: readonly DocsNode[]) =>
    nodes.forEach(node => {
      if (node.kind === 'section') collect(node.children);
      else if (node.kind === 'page' && !node.missing && !titles.has(node.path)) {
        titles.set(node.path, node.title);
        if (node.fixedTitle) fixed.add(node.path);
      }
    });
  collect(tree.nodes);
  const outside = new Set(tree.notInNav.flatMap(node => (node.kind === 'page' ? [node.path] : [])));
  collect(tree.notInNav);
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  const build = (folder: string, under: DocsItem | undefined): DocsItem[] => {
    const prefix = folder ? `${folder}/` : '';
    const inside = [...titles.keys()].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length));
    const dirs = [...new Set(inside.filter(rest => rest.includes('/')).map(rest => rest.split('/')[0]))].sort(compare);
    const files = inside.filter(rest => !rest.includes('/')).sort(compare);
    return [
      ...dirs.map(name => {
        const dir = new DocsItem('dir', name, under, vscode.Uri.joinPath(docsDir, prefix + name));
        dir.path = prefix + name;
        dir.local = local;
        dir.children.push(...build(prefix + name, dir));
        return dir;
      }),
      ...files.map(name => {
        const path = prefix + name;
        const page = new DocsItem('page', titles.get(path)!, under, vscode.Uri.joinPath(docsDir, path));
        page.path = path;
        page.file = true;
        page.local = local;
        page.home = /^(index|readme)\.md$/i.test(path);
        page.outside = outside.has(path);
        page.fixedTitle = fixed.has(path);
        pages.set(page.uri!.toString(), page);
        return page;
      }),
    ];
  };
  return build('', parent);
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Dica do ⚠ de uma página: só fala em "Ajustar agora" quando o botão resolve, porque avisos como o de
 * linha comprida não têm ajuste automático (a pessoa procurava um botão que não existe).
 */
function problemsTooltip(problems: number, fixable: number) {
  if (fixable >= problems)
    return problems === 1
      ? vscode.l10n.t('1 formatting problem. Open the page and use Fix automatically.')
      : vscode.l10n.t('{0} formatting problems. Open the page and use Fix automatically.', problems);
  if (!fixable)
    return problems === 1
      ? vscode.l10n.t('1 formatting problem. Open the page to see what to change.')
      : vscode.l10n.t('{0} formatting problems. Open the page to see what to change.', problems);
  return vscode.l10n.t('{0} formatting problems, {1} with an automatic fix. Open the page to see them.', problems, fixable);
}
