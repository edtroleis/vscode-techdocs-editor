import * as vscode from 'vscode';
import { logLine } from './timing';
import { filesUnder } from './docsFiles';
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
/** Pastas que a visão dos arquivos nunca mostra (além do `files.exclude` do VS Code). */
const HIDDEN_FOLDERS = new Set(['.git', 'node_modules']);
/** Os últimos sites mostrados, o mais recente primeiro. */
const RECENT_KEY = 'techdocsEditor.recentSites';
/** A visão da árvore, por workspace: os arquivos do `docs_dir` ou o menu do site. */
const MODE_KEY = 'techdocsEditor.treeMode';

/**
 * `files`: a pasta do site como no disco (como o Explorer), com o `docs_dir` aberto: as pastas, as páginas pelo nome e
 * os outros arquivos, como as imagens; o resto (README, código) para consultar. `menu`: só o menu do site, pelos títulos.
 */
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
  /** `repoDir`: a raiz do repositório Git do site (senão a pasta do site), onde a visão dos arquivos começa. */
  local?: { mkdocs: vscode.Uri; site: DocsSite; yml: string | undefined; repoDir: vscode.Uri };
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
  /** A pasta do `docs_dir` na visão dos arquivos: aberta de saída, sem renomear nem mover. */
  docsRoot?: boolean;
  /** Pasta fora do `docs_dir` (`repoDir`): o conteúdo é lido só quando ela abre. */
  load?: () => Promise<DocsItem[]>;
  /** Pasta aberta de saída (o caminho até o `docs_dir`). */
  open?: boolean;
  /** O `mkdocs.yml` na visão dos arquivos: quantas páginas do menu não existem (o ⚠ leva à visão do menu). */
  missingInMenu?: number;
  constructor(
    /**
     * `asset`: arquivo do `docs_dir` que não é página (imagem…); `repoDir` e `repoFile`: pasta e arquivo da pasta do
     * site fora do `docs_dir` (README, código, `mkdocs.yml`), só para consultar.
     */
    readonly kind: 'site' | 'remote' | 'remoteError' | 'section' | 'dir' | 'page' | 'missing' | 'link' | 'notInNav' | 'asset' | 'repoDir' | 'repoFile',
    readonly label: string,
    /** Muda só na pasta do `docs_dir`, montada antes da pasta do site em volta dela. */
    public parent: DocsItem | undefined,
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
  /** A conferência periódica do site mostrado (`checkShown`). */
  private readonly watch = setInterval(() => void this.checkShown(), CHECK_SHOWN_MS);
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
  /** Pasta sem documentação escolhida na troca de diretório: a árvore fica vazia, com a tela de criar. */
  private emptyFolder: vscode.Uri | undefined;
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
    // As pastas fora do docs_dir leem o conteúdo quando abrem: o VS Code pede os filhos por aqui
    const treeDataProvider: vscode.TreeDataProvider<DocsItem> = {
      onDidChangeTreeData: this.onDidChangeTreeData,
      getTreeItem: item => this.getTreeItem(item),
      getParent: item => this.getParent(item),
      getChildren: async item => {
        if (item?.load) {
          const load = item.load;
          item.load = undefined;
          item.children.push(...(await load()));
        }
        return this.getChildren(item);
      },
    };
    this.view = vscode.window.createTreeView(DOCS_VIEW, { treeDataProvider, showCollapseAll: false, dragAndDropController, canSelectMany: false });
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    // Pasta apagada (ou renomeada): o VS Code avisa só a pasta, não os `.md` de dentro
    const deletions = vscode.workspace.createFileSystemWatcher('**/*', true, true, false);
    // Só o que muda dentro de um site (ou numa pasta acima dele) remonta a árvore: aberto no ~, o resto do home
    // (caches, logs, outros projetos) não tem nada a ver com ela
    const later = (uri?: vscode.Uri) => {
      if (!uri || this.concerns(uri)) this.refreshLater(uri ? uri.path.split('/').slice(-2).join('/') : undefined);
    };
    this.statusItem.name = vscode.l10n.t('Current documentation');
    this.statusItem.command = 'techdocsEditor.chooseSite';
    this.disposables.push(
      this.view,
      this.statusItem,
      this.changeEmitter,
      watcher,
      watcher.onDidCreate(uri => later(uri)),
      watcher.onDidDelete(uri => later(uri)),
      // O título da página vem do título 1: mudou ao salvar
      watcher.onDidChange(uri => later(uri)),
      deletions,
      deletions.onDidDelete(uri => later(uri)),
      sites.onDidChange(() => later()),
      remotes.onDidChange(() => later()),
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
    const collapsible = item.children.length || item.load
      ? ((item.kind === 'site' || item.kind === 'remote') && !item.parent) || item.docsRoot || item.open
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const label = item.file ? item.uri!.path.split('/').pop()! : (item.place ?? item.label);
    const tree = new vscode.TreeItem(label, collapsible);
    tree.description = item.description;
    // `page local home`: os menus e os atalhos olham as palavras
    tree.contextValue = [item.kind, item.local && 'local', item.home && 'home', item.outside && 'outside', item.fixedTitle && 'fixedTitle', item.file && 'file', item.docsRoot && 'docsRoot', item.kind === 'repoFile' && isPage(item.uri!) && 'markdown']
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
        // Na visão dos arquivos: o título ao lado do nome do arquivo (vários index.md se distinguem), e a página fora do
        // menu se vê sem abrir a dica. O título igual ao nome do arquivo não se repete
        if (item.file) {
          const stem = item.uri!.path.split('/').pop()!.replace(/\.md$/i, '');
          const title = item.label.trim().toLowerCase() === stem.toLowerCase() ? '' : item.label;
          tree.description = [title, item.outside && vscode.l10n.t('not in the menu')].filter(Boolean).join(' · ') || undefined;
        }
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
      case 'dir': {
        // A pasta das páginas se destaca com o livro
        tree.iconPath = item.docsRoot ? new vscode.ThemeIcon('book') : vscode.ThemeIcon.Folder;
        // Sem o caminho na dica (a árvore já mostra onde a pasta está); só a das páginas explica o que ela é
        tree.tooltip = item.docsRoot ? vscode.l10n.t('The pages of the site (docs_dir in mkdocs.yml)') : '';
        // Pasta fechada não esconde página fora do menu: quantas há dentro dela
        const outside = countOutside(item.children);
        if (outside) tree.description = outside === 1 ? vscode.l10n.t('1 not in the menu') : vscode.l10n.t('{0} not in the menu', outside);
        break;
      }
      case 'repoDir':
        tree.iconPath = vscode.ThemeIcon.Folder;
        tree.resourceUri = item.uri;
        // Sem o caminho na dica, como nas pastas da docs
        tree.tooltip = '';
        break;
      // O mkdocs.yml com páginas do menu que não existem: o ⚠ e o clique levam à visão do menu, onde se corrige
      case 'repoFile':
        if (item.missingInMenu) {
          tree.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
          tree.resourceUri = item.uri;
          tree.description =
            item.missingInMenu === 1 ? vscode.l10n.t('1 page of the menu does not exist') : vscode.l10n.t('{0} pages of the menu do not exist', item.missingInMenu);
          tree.tooltip = vscode.l10n.t('The nav of mkdocs.yml points to pages that do not exist. Click to see them in the menu of the site, where you can create them or take them out.');
          tree.command = { command: 'techdocsEditor.showMenu', title: vscode.l10n.t('Show the menu of the site') };
          break;
        }
      // falls through
      // Arquivos que não são páginas: o ícone do tema pelo nome do arquivo, e o clique abre como no Explorer
      case 'asset':
        tree.iconPath = vscode.ThemeIcon.File;
        tree.resourceUri = item.uri;
        tree.tooltip = vscode.workspace.asRelativePath(item.uri!);
        tree.command = { command: 'vscode.open', title: vscode.l10n.t('Open'), arguments: [item.uri] };
        break;
      // O site é a linha da pasta: onde se está trabalhando; o clique troca (o nome do site fica na dica)
      case 'site':
      case 'remote': {
        tree.iconPath = new vscode.ThemeIcon(item.kind === 'remote' ? 'github' : 'folder-opened');
        tree.description = undefined;
        const where = item.kind === 'remote' ? vscode.l10n.t('Read from GitHub: {0}', item.description!) : item.siteRoot?.fsPath;
        tree.tooltip = [item.label, where, vscode.l10n.t('Click to switch the documentation.')].filter(Boolean).join('\n');
        tree.command = { command: 'techdocsEditor.chooseSite', title: vscode.l10n.t('Switch directory or repo') };
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

  /** A pasta sem documentação mostrada (a tela "Criar a documentação" dela). */
  get folderWithoutDocs(): vscode.Uri | undefined {
    return this.emptyFolder;
  }

  /** Mostra uma pasta sem documentação: a árvore vazia, com a tela de criar nela. */
  selectFolder(folder: vscode.Uri): Promise<void> {
    this.follow = undefined;
    this.emptyFolder = folder;
    this.ready = this.refresh();
    return this.ready;
  }

  /** Mostra o site (a chave de `siteCandidates`). */
  select(key: string): Promise<void> {
    this.follow = undefined;
    this.emptyFolder = undefined;
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

  /** "Trocar diretório ou repo" (ver sitePicker.ts). */
  async chooseSite() {
    await this.ready;
    if (testSitePick) {
      const key = testSitePick([...this.candidates].sort((a, b) => a.repo.localeCompare(b.repo) || a.label.localeCompare(b.label)));
      if (key) await this.select(key);
      return;
    }
    // Começa na pasta de cima do repositório mostrado (aberto em ~, com um repo de ~/code: em ~/code)
    const shown = this.emptyFolder ?? this.candidates.find(c => c.key === this.currentKey)?.local?.repoDir;
    const above = shown && shown.with({ path: shown.path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/' });
    await pickSite({
      start: above && vscode.workspace.getWorkspaceFolder(above) ? above : undefined,
      candidates: this.candidates,
      selectFolder: folder => this.selectFolder(folder),
      refresh: async () => {
        this.ready = this.refresh();
        await this.ready;
        return this.candidates;
      },
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

  /**
   * Confere o site mostrado sem esperar o observador de arquivos, que perde eventos num workspace grande (o `~`, no
   * WSL): o `mkdocs.yml` do site atual sumiu, ou apareceu um na pasta sem documentação. Uma consulta só (o arquivo
   * do site mostrado), barata o bastante para rodar sempre.
   */
  private async checkShown() {
    const local = this.candidates.find(c => c.key === this.currentKey)?.local;
    if (this.emptyFolder) {
      for (const name of ['mkdocs.yml', 'mkdocs.yaml']) {
        const mkdocs = vscode.Uri.joinPath(this.emptyFolder, name);
        if (await exists(mkdocs)) {
          await this.sites.add(mkdocs);
          return;
        }
      }
    } else if (local && !(await exists(local.mkdocs))) this.refreshLater();
    // O site atual já saiu da lista, mas a montagem não passou à pasta dele (o aviso chegou no meio de outra)
    else if (!local && (await this.vanishedFolder(this.candidates))) this.refreshLater();
  }

  dispose() {
    clearInterval(this.watch);
    clearTimeout(this.timer);
    clearTimeout(this.diagnosticsTimer);
    this.disposables.forEach(d => d.dispose());
  }

  /** O arquivo é de um site (ou da pasta mostrada), ou é uma pasta acima de um: o que muda nele pode mudar a árvore. */
  private concerns(uri: vscode.Uri): boolean {
    const path = uri.path;
    // Só o site mostrado conta: os outros sites (e o resto do ~) não aparecem na árvore. Um site novo ou apagado
    // chega pela lista dos sites (sites.onDidChange)
    const shown = this.candidates.find(c => c.key === this.currentKey)?.local;
    const roots = [shown?.repoDir.path, shown?.site.root, this.emptyFolder?.path].filter((r): r is string => Boolean(r));
    return roots.some(root => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`));
  }

  private refreshLater(reason?: string) {
    if (reason) this.refreshReason = reason;
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

  /** O que pediu a próxima montagem (para o registro no canal "TechDocs Editor"). */
  private refreshReason: string | undefined;
  /** Quanto cada etapa da última montagem levou (para o registro). */
  private buildSteps = '';

  private async build(run: number): Promise<void> {
    const started = performance.now();
    const reason = this.refreshReason;
    this.refreshReason = undefined;
    try {
      await this.buildTree(run);
    } finally {
      logLine(`árvore montada em ${Math.round(performance.now() - started)} ms [${this.buildSteps}]${reason ? ` (mudou: ${reason})` : ''}`);
    }
  }

  private async buildTree(run: number): Promise<void> {
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasDocs', this.sites.all().length > 0);
    const remotes = this.remotes.list();
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasRemote', remotes.length > 0);
    const started = performance.now();
    const candidates = await this.loadCandidates();
    this.buildSteps = `sites ${Math.round(performance.now() - started)} ms`;
    const pages = new Map<string, DocsItem>();
    // A página aberta de outro site; senão o escolhido; senão o único
    const followed = this.follow && keyOf(candidates, this.sites, this.follow);
    // A pasta sem documentação continua até virar site (criado nela) ou até abrir a página de outro site
    let empty = this.emptyFolder ?? (followed ? undefined : await this.vanishedFolder(candidates));
    const created = empty && candidates.find(c => c.local?.site.root === empty!.path);
    if (followed || created) empty = undefined;
    let current = empty ? undefined : (candidates.find(c => c.key === followed) ?? created ?? candidates.find(c => c.key === this.currentKey));
    if (!current && !empty && candidates.length === 1) current = candidates[0];
    const roots: DocsItem[] = [];
    let shown: typeof this.shownSite;
    if (current?.local) {
      const { mkdocs, site, yml, repoDir } = current.local;
      const docsDir = mkdocs.with({ path: site.docsDir });
      const parent = new DocsItem('site', current.label, undefined, docsDir, current.description);
      parent.siteRoot = mkdocs.with({ path: site.root });
      parent.local = true;
      parent.place = current.place;
      const before = performance.now();
      const { tree, items } = await this.siteItems(yml, site, docsDir, parent, pages, repoDir);
      this.buildSteps += `, páginas ${Math.round(performance.now() - before)} ms`;
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
    this.emptyFolder = empty;
    if (current && current.key !== this.currentKey) this.setCurrent(current.key);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.emptyFolder', Boolean(empty));
    // O nome da pasta no título da seção (uma mensagem na árvore esconderia a tela com os botões de criar)
    this.view.description = empty ? folderLabel(empty) : undefined;
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.needsSite', candidates.length > 1 && !current && !empty);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.manySites', candidates.length > 1);
    this.roots = roots;
    this.pages = pages;
    this.shownSite = shown;
    // O site atual na barra de status: um clique troca (com mais de um)
    if (empty) {
      this.statusItem.text = `$(folder) ${folderLabel(empty)}`;
      this.statusItem.tooltip = vscode.l10n.t('Folder without documentation shown in the TechDocs sidebar. Click to switch.');
      this.statusItem.show();
    } else if (current && candidates.length > 1) {
      this.statusItem.text = `$(book) ${current.label}`;
      this.statusItem.tooltip = vscode.l10n.t('Documentation shown in the TechDocs sidebar. Click to switch.');
      this.statusItem.show();
    } else this.statusItem.hide();
    this.changeEmitter.fire();
    this.revealActive();
  }

  /** A pasta do site atual cujo `mkdocs.yml` foi apagado, se ela ainda existe: a árvore fica nela, com a tela de criar. */
  private async vanishedFolder(candidates: SiteCandidate[]): Promise<vscode.Uri | undefined> {
    const key = this.currentKey;
    if (!key || candidates.some(c => c.key === key)) return undefined;
    const mkdocs = vscode.Uri.parse(key);
    if (!vscode.workspace.getWorkspaceFolder(mkdocs) || !/\/mkdocs\.ya?ml$/.test(mkdocs.path) || (await exists(mkdocs))) return undefined;
    const folder = mkdocs.with({ path: mkdocs.path.replace(/\/[^/]*$/, '') });
    return (await exists(folder)) ? folder : undefined;
  }

  /** Os sites do workspace (os escolhidos em `techdocsEditor.sites`) e os abertos do GitHub. */
  private async loadCandidates(): Promise<SiteCandidate[]> {
    const found = await Promise.all(
      this.sites.list().map(async ({ mkdocs, site }): Promise<SiteCandidate | undefined> => {
        const yml = await readText(mkdocs);
        const root = mkdocs.with({ path: site.root });
        // O mkdocs.yml sumiu sem aviso (o observador do VS Code perde eventos num workspace grande, como o ~)
        if (yml === undefined && !(await exists(mkdocs))) {
          this.sites.forget(mkdocs);
          return undefined;
        }
        // Sem Git, a visão dos arquivos é a pasta do site (não a pasta aberta, que pode ser o ~)
        const repoDir = (await repoDirOf(root)) ?? root;
        const inRepo = root.path.slice(repoDir.path.replace(/\/$/, '').length + 1);
        const repoName = repoDir.path.replace(/\/$/, '').split('/').pop() || site.root.split('/').pop()!;
        return {
          key: mkdocs.toString(),
          label: usableName(siteName(yml)) ?? site.root.split('/').pop()!,
          description: vscode.workspace.asRelativePath(root),
          repo: await repoOf(root),
          place: inRepo ? `${repoName} › ${inRepo}` : repoName,
          local: { mkdocs, site, yml, repoDir },
        };
      }),
    );
    const local = found.filter((c): c is SiteCandidate => c !== undefined);
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

  private async siteItems(yml: string | undefined, site: DocsSite, docsDir: vscode.Uri, parent: DocsItem | undefined, pages: Map<string, DocsItem>, repoDir: vscode.Uri) {
    // Só os do site (um site dentro do docs_dir de outro fica com os dele)
    // (o siteOf só aceita página: um arquivo que não é página conta pelo site da pasta dele)
    const siteOfFile = (uri: vscode.Uri) => this.sites.siteOf(isPage(uri) ? uri : uri.with({ path: `${dirOf(uri.path)}/index.md` }));
    const own = (await filesUnder(docsDir, this.treeMode !== 'files')).filter(uri => siteOfFile(uri)?.docsDir === site.docsDir);
    const relative = (uri: vscode.Uri) => uri.path.slice(site.docsDir.length + 1);
    const titles = new Map<string, string | undefined>();
    await Promise.all(own.filter(isPage).map(async uri => titles.set(relative(uri), pageTitle((await readText(uri)) ?? ''))));
    const tree = docsTree(yml, [...titles.keys()], path => titles.get(path));
    if (this.treeMode === 'menu') return { tree, items: treeItems(tree, docsDir, parent, pages, true) };
    // Visão dos arquivos: o repositório como no disco (o README da raiz, as outras pastas), com o caminho até o
    // docs_dir aberto
    const assets = own.filter(uri => !isPage(uri)).map(relative).filter(path => !path.split('/').some(part => part.startsWith('.')));
    const docs = docsDirItem(docsDir, site.docsDir.split('/').pop()!, undefined, true);
    docs.children.push(...fileItems(tree, docsDir, docs, pages, true, assets));
    const items = await folderItems(repoDir, parent, docs);
    const missing = countMissing(tree.nodes);
    if (missing) {
      const mkdocs = findItem(items, item => item.kind === 'repoFile' && item.uri?.path === `${site.root}/${item.label}` && /^mkdocs\.ya?ml$/.test(item.label));
      if (mkdocs) mkdocs.missingInMenu = missing;
    }
    return { tree, items };
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
      const docsDir = remoteUri(entry.host, entry.slug, site.docsDir);
      if (this.treeMode === 'files') {
        // A pasta do docs_dir, como nos sites do workspace (os arquivos de configuração do GitHub ainda não aparecem)
        const dir = docsDirItem(docsDir, site.docsDir.slice(site.root ? site.root.length + 1 : 0), named, false);
        dir.children.push(...fileItems(remote.tree, docsDir, dir, pages, false));
        named.children.push(dir);
      } else named.children.push(...treeItems(remote.tree, docsDir, named, pages, false));
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
const exists = (uri: vscode.Uri) => Promise.resolve(vscode.workspace.fs.stat(uri)).then(() => true, () => false);

/** De quanto em quanto tempo a árvore confere o `mkdocs.yml` do site mostrado. */
const CHECK_SHOWN_MS = 3000;

const folderLabel = (folder: vscode.Uri) => folder.path.replace(/\/+$/, '').split('/').pop() || folder.path;

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
function fileItems(tree: DocsTree, docsDir: vscode.Uri, parent: DocsItem | undefined, pages: Map<string, DocsItem>, local: boolean, assets: readonly string[] = []): DocsItem[] {
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
    const inside = [...titles.keys(), ...assets].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length));
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
        if (!titles.has(path)) {
          const asset = new DocsItem('asset', name, under, vscode.Uri.joinPath(docsDir, path));
          asset.path = path;
          asset.local = local;
          return asset;
        }
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

const isPage = (uri: vscode.Uri) => /\.md$/i.test(uri.path);

/** Páginas do menu que não existem (em todas as seções). */
function countMissing(nodes: readonly DocsNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.kind === 'section' ? countMissing(node.children) : node.kind === 'page' && node.missing ? 1 : 0), 0);
}

/** Páginas fora do menu entre os itens e dentro das pastas deles (visão dos arquivos). */
function countOutside(items: readonly DocsItem[]): number {
  return items.reduce((sum, item) => sum + (item.kind === 'page' && item.outside ? 1 : 0) + countOutside(item.children), 0);
}

/** O primeiro item (entre os já lidos) que satisfaz `match`. */
function findItem(items: readonly DocsItem[], match: (item: DocsItem) => boolean): DocsItem | undefined {
  for (const item of items) {
    if (match(item)) return item;
    const inside = findItem(item.children, match);
    if (inside) return inside;
  }
  return undefined;
}

/** A pasta do `docs_dir` na visão dos arquivos (`name`: o caminho dela na pasta do site, normalmente `docs`). */
function docsDirItem(docsDir: vscode.Uri, name: string, parent: DocsItem | undefined, local: boolean): DocsItem {
  const dir = new DocsItem('dir', name || 'docs', parent, docsDir);
  dir.path = '';
  dir.local = local;
  dir.docsRoot = true;
  return dir;
}

/**
 * O conteúdo de uma pasta do site, como o Explorer (as pastas primeiro, cada lista em ordem alfabética), sem `.git`,
 * `node_modules` e o `files.exclude`. O `docs_dir` entra pronto (`docs`) e o caminho até ele vem aberto; as outras
 * pastas leem o conteúdo quando abrem.
 */
async function folderItems(folder: vscode.Uri, parent: DocsItem | undefined, docs: DocsItem): Promise<DocsItem[]> {
  const entries = await vscode.workspace.fs.readDirectory(folder).then(
    list => list,
    () => [] as [string, vscode.FileType][],
  );
  const excluded = excludedNames();
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  const shown = entries.filter(([name, type]) => !excluded.has(name) && !(type & vscode.FileType.Directory && HIDDEN_FOLDERS.has(name)));
  const dirs = shown.filter(([, type]) => type & vscode.FileType.Directory).map(([name]) => name).sort(compare);
  const files = shown.filter(([, type]) => !(type & vscode.FileType.Directory)).map(([name]) => name).sort(compare);
  const docsPath = docs.uri!.path;
  const items: DocsItem[] = [];
  for (const name of dirs) {
    const uri = vscode.Uri.joinPath(folder, name);
    if (uri.path === docsPath) {
      docs.parent = parent;
      items.push(docs);
      continue;
    }
    const dir = new DocsItem('repoDir', name, parent, uri);
    dir.local = true;
    if (docsPath.startsWith(`${uri.path}/`)) {
      dir.open = true;
      dir.children.push(...(await folderItems(uri, dir, docs)));
    } else dir.load = () => folderItems(uri, dir, docs);
    items.push(dir);
  }
  for (const name of files) {
    const file = new DocsItem('repoFile', name, parent, vscode.Uri.joinPath(folder, name));
    file.local = true;
    items.push(file);
  }
  return items;
}

/** Os nomes que o `files.exclude` do VS Code esconde (as regras de um nome só, em qualquer pasta ou na raiz: as mais comuns). */
function excludedNames(): Set<string> {
  const excluded = vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude') ?? {};
  return new Set(
    Object.entries(excluded)
      .filter(([, on]) => on === true)
      .map(([glob]) => glob.replace(/^\*\*\//, ''))
      .filter(name => !/[*?{}[\]/]/.test(name)),
  );
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
