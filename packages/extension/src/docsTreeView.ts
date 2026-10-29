import * as vscode from 'vscode';
import { DocsNode, DocsTree, docsTree, loadRemoteSiteTree, pageTitle, REMOTE_SCHEME, siteName } from '@edtroleis/techdocs-editor-core';
import { CHOOSE_SITES_THRESHOLD, type DocsSite } from './docsSite';
import type { LocalSites } from './localSites';
import { remoteUri } from './remote/remoteFs';
import { type RemoteEntry, type RemoteRepos, SignInRequiredError } from './remote/remoteRepos';

export const DOCS_VIEW = 'techdocsEditor.docs';
const REFRESH_DELAY_MS = 300;

/**
 * Item da árvore: um site (com mais de um no workspace), um site aberto do GitHub (`remote`), uma seção, uma
 * página, um link do `nav` ou o aviso de que o site do GitHub não pôde ser lido (`remoteError`).
 */
export class DocsItem {
  readonly children: DocsItem[] = [];
  /** O site do GitHub do item `remote` (para fechar e ler de novo). */
  remote?: RemoteEntry;
  /** Pasta do `mkdocs.yml` do item `site` (para esconder). */
  siteRoot?: vscode.Uri;
  constructor(
    readonly kind: 'site' | 'remote' | 'remoteError' | 'section' | 'page' | 'missing' | 'link' | 'notInNav' | 'chooseSites' | 'hiddenSites',
    readonly label: string,
    readonly parent: DocsItem | undefined,
    /** Página ou arquivo do link (link externo: o endereço). */
    readonly uri?: vscode.Uri,
    readonly description?: string,
  ) {}
}

/**
 * Árvore "Documentação" no Explorer (spec 02, LC6): as páginas de cada site do MkDocs do workspace, pelo
 * `nav` do `mkdocs.yml` ou pelas pastas. Clicar abre a página como o resto do VS Code (ou no visual, com
 * `techdocsEditor.openVisualByDefault`); a página aberta fica selecionada na árvore.
 */
export class DocsTreeView implements vscode.TreeDataProvider<DocsItem>, vscode.Disposable {
  private roots: DocsItem[] = [];
  private pages = new Map<string, DocsItem>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly view: vscode.TreeView<DocsItem>;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private runs = 0;
  private latest: Promise<void> = Promise.resolve();
  /** Última montagem da árvore (os testes esperam por ela). */
  ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly sites: LocalSites,
    private readonly remotes: RemoteRepos,
  ) {
    this.view = vscode.window.createTreeView(DOCS_VIEW, { treeDataProvider: this, showCollapseAll: true });
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    // Pasta apagada (ou renomeada): o VS Code avisa só a pasta, não os `.md` de dentro
    const deletions = vscode.workspace.createFileSystemWatcher('**/*', true, true, false);
    const later = () => this.refreshLater();
    this.disposables.push(
      this.view,
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
      vscode.window.tabGroups.onDidChangeTabs(() => this.revealActive()),
      this.view.onDidChangeVisibility(() => this.revealActive()),
    );
    this.ready = sites.ready.then(() => this.refresh());
  }

  getTreeItem(item: DocsItem): vscode.TreeItem {
    const collapsible = item.children.length
      ? item.kind === 'site'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const tree = new vscode.TreeItem(item.label, collapsible);
    tree.description = item.description;
    tree.contextValue = item.kind;
    switch (item.kind) {
      case 'page':
        tree.resourceUri = item.uri;
        tree.tooltip = vscode.workspace.asRelativePath(item.uri!);
        tree.command = { command: 'vscode.open', title: vscode.l10n.t('Open'), arguments: [item.uri] };
        break;
      case 'missing':
        tree.iconPath = new vscode.ThemeIcon('warning');
        tree.tooltip = vscode.l10n.t('The nav in mkdocs.yml points to a page that does not exist: {0}', item.description!);
        break;
      case 'link':
        tree.iconPath = new vscode.ThemeIcon('link-external');
        tree.tooltip = item.uri!.toString(true);
        tree.command = { command: 'vscode.open', title: vscode.l10n.t('Open'), arguments: [item.uri] };
        break;
      case 'notInNav':
        tree.iconPath = new vscode.ThemeIcon('eye-closed');
        tree.tooltip = vscode.l10n.t('Pages in docs_dir that are not in the nav of mkdocs.yml: MkDocs builds them, but they are not in the menu');
        break;
      case 'site':
        tree.iconPath = new vscode.ThemeIcon('book');
        break;
      case 'remote':
        tree.iconPath = new vscode.ThemeIcon('github');
        tree.tooltip = vscode.l10n.t('Read from GitHub: {0}', item.description!);
        break;
      case 'remoteError':
        tree.iconPath = new vscode.ThemeIcon('warning');
        tree.tooltip = item.label;
        break;
      case 'chooseSites':
      case 'hiddenSites':
        tree.iconPath = new vscode.ThemeIcon(item.kind === 'chooseSites' ? 'list-filter' : 'eye-closed');
        tree.command = { command: 'techdocsEditor.chooseSites', title: item.label };
        break;
    }
    if (item.kind === 'page' && item.uri?.scheme === REMOTE_SCHEME) {
      // Página do GitHub: abre no editor visual, como no portal
      tree.command = { command: 'techdocsEditor.openVisual', title: vscode.l10n.t('Open'), arguments: [item.uri] };
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

  /** Item da página na árvore (testes e "revelar a página aberta"). */
  pageItem(uri: vscode.Uri): DocsItem | undefined {
    return this.pages.get(uri.toString());
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposables.forEach(d => d.dispose());
  }

  private refreshLater() {
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
    const all = this.sites.all();
    const sites = this.sites.list();
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasDocs', all.length > 0);
    const pages = new Map<string, DocsItem>();
    const remotes = this.remotes.list();
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasRemote', remotes.length > 0);
    const hidden = all.length - sites.length;
    const single = sites.length === 1 && !remotes.length && !hidden;
    const roots: DocsItem[] = [];
    // Muitos sites e nada escolhido (workspace com vários repositórios): sugere escolher quais mostrar
    if (this.sites.chosen() === null && all.length > CHOOSE_SITES_THRESHOLD) {
      roots.push(new DocsItem('chooseSites', vscode.l10n.t('Choose which documentation to show…'), undefined, undefined, vscode.l10n.t('{0} found', all.length)));
    }
    for (const { mkdocs, site } of sites) {
      const yml = await readText(mkdocs);
      const docsDir = mkdocs.with({ path: site.docsDir });
      const parent = single
        ? undefined
        : new DocsItem('site', siteName(yml) ?? site.root.split('/').pop()!, undefined, docsDir, vscode.workspace.asRelativePath(mkdocs.with({ path: site.root })));
      if (parent) parent.siteRoot = mkdocs.with({ path: site.root });
      const items = await this.siteItems(yml, site, docsDir, parent, pages);
      if (parent) {
        parent.children.push(...items);
        roots.push(parent);
      } else roots.push(...items);
    }
    if (hidden) roots.push(new DocsItem('hiddenSites', vscode.l10n.t('{0} hidden', hidden), undefined, undefined, vscode.l10n.t('Choose documentation…')));
    for (const entry of remotes) roots.push(await this.remoteItem(entry, pages));
    if (run !== this.runs) return this.latest;
    this.roots = roots;
    this.pages = pages;
    this.changeEmitter.fire();
    this.revealActive();
  }

  private async siteItems(yml: string | undefined, site: DocsSite, docsDir: vscode.Uri, parent: DocsItem | undefined, pages: Map<string, DocsItem>) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(docsDir, '**/*.md'));
    // Só as do site (um site dentro do docs_dir de outro fica com as dele)
    const own = files.filter(uri => this.sites.siteOf(uri)?.docsDir === site.docsDir);
    const relative = (uri: vscode.Uri) => uri.path.slice(site.docsDir.length + 1);
    const titles = new Map<string, string | undefined>();
    await Promise.all(own.map(async uri => titles.set(relative(uri), pageTitle((await readText(uri)) ?? ''))));
    return treeItems(docsTree(yml, [...titles.keys()], path => titles.get(path)), docsDir, parent, pages);
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
      const named = new DocsItem('remote', site.name, undefined, item.uri, item.description);
      named.remote = entry;
      named.children.push(...treeItems(remote.tree, remoteUri(entry.host, entry.slug, site.docsDir), named, pages));
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
    if (item) void this.view.reveal(item, { select: true, focus: false, expand: true }).then(undefined, () => {});
  }
}

/** Itens da árvore de um site (o `nav`, ou as pastas, e as páginas fora do `nav`), com as páginas em `pages`. */
function treeItems(tree: DocsTree, docsDir: vscode.Uri, parent: DocsItem | undefined, pages: Map<string, DocsItem>): DocsItem[] {
  const toItem = (node: DocsNode, under: DocsItem | undefined): DocsItem => {
    if (node.kind === 'section') {
      const section = new DocsItem('section', node.title, under);
      section.children.push(...node.children.map(child => toItem(child, section)));
      return section;
    }
    if (node.kind === 'link') {
      const uri = /^[a-z][a-z0-9+.-]*:/i.test(node.url) ? vscode.Uri.parse(node.url) : vscode.Uri.joinPath(docsDir, node.url);
      return new DocsItem('link', node.title, under, uri);
    }
    if (node.missing) return new DocsItem('missing', node.title, under, undefined, node.path);
    const page = new DocsItem('page', node.title, under, vscode.Uri.joinPath(docsDir, node.path));
    pages.set(page.uri!.toString(), page);
    return page;
  };
  const items = tree.nodes.map(node => toItem(node, parent));
  if (tree.notInNav.length) {
    const group = new DocsItem('notInNav', vscode.l10n.t('Not in the nav'), parent);
    group.children.push(...tree.notInNav.map(node => toItem(node, group)));
    items.push(group);
  }
  return items;
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
