import * as vscode from 'vscode';
import { DocsNode, docsTree, pageTitle, siteName } from '@edtroleis/techdocs-editor-core';
import type { DocsSite } from './docsSite';
import type { LocalSites } from './localSites';

export const DOCS_VIEW = 'techdocsEditor.docs';
const REFRESH_DELAY_MS = 300;

/** Item da árvore: um site (com mais de um no workspace), uma seção, uma página ou um link do `nav`. */
export class DocsItem {
  readonly children: DocsItem[] = [];
  constructor(
    readonly kind: 'site' | 'section' | 'page' | 'missing' | 'link' | 'notInNav',
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

  constructor(private readonly sites: LocalSites) {
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
    const sites = this.sites.list();
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasDocs', sites.length > 0);
    const pages = new Map<string, DocsItem>();
    const single = sites.length === 1;
    const roots: DocsItem[] = [];
    for (const { mkdocs, site } of sites) {
      const yml = await readText(mkdocs);
      const docsDir = mkdocs.with({ path: site.docsDir });
      const parent = single
        ? undefined
        : new DocsItem('site', siteName(yml) ?? site.root.split('/').pop()!, undefined, docsDir, vscode.workspace.asRelativePath(mkdocs.with({ path: site.root })));
      const items = await this.siteItems(yml, site, docsDir, parent, pages);
      if (parent) {
        parent.children.push(...items);
        roots.push(parent);
      } else roots.push(...items);
    }
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
    const tree = docsTree(yml, [...titles.keys()], path => titles.get(path));

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

  /** Seleciona na árvore a página do editor ativo (texto ou visual), como o Explorer faz com o arquivo. */
  private revealActive() {
    if (!this.view.visible) return;
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
    const item = uri && this.pageItem(uri);
    if (item) void this.view.reveal(item, { select: true, focus: false, expand: true }).then(undefined, () => {});
  }
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
