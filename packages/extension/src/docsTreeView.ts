import * as vscode from 'vscode';
import { DocsNode, DocsTree, docsTree, loadRemoteSiteTree, pageTitle, parseRemoteUri, REMOTE_SCHEME, siteName } from '@edtroleis/techdocs-editor-core';
import { repoOf } from './chooseSites';
import type { DocsSite } from './docsSite';
import type { LocalSites } from './localSites';
import { remoteUri } from './remote/remoteFs';
import { type RemoteEntry, type RemoteRepos, SignInRequiredError } from './remote/remoteRepos';

export const DOCS_VIEW = 'techdocsEditor.docs';
const REFRESH_DELAY_MS = 300;
/** Site escolhido no seletor, por workspace. */
const CURRENT_KEY = 'techdocsEditor.currentSite';

/** Um site que o seletor oferece: do workspace (`local`) ou aberto do GitHub (`remote`). */
export type SiteCandidate = {
  /** O `mkdocs.yml` do site local, ou `remote:host/dono/repo/pasta`. */
  key: string;
  label: string;
  /** A pasta do site no workspace, ou `dono/repo/pasta` no GitHub. */
  description: string;
  /** Agrupa a lista: o repositório Git da pasta, ou `host/dono/repo`. */
  repo: string;
  local?: { mkdocs: vscode.Uri; site: DocsSite; yml: string | undefined };
  remote?: RemoteEntry;
};

/** Testes de integração: o site escolhido na lista (a chave; undefined = cancelar). */
let testSitePick: ((candidates: SiteCandidate[]) => string | undefined) | undefined;
export function useTestSitePick(pick: typeof testSitePick) {
  testSitePick = pick;
}

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
    readonly kind: 'site' | 'remote' | 'remoteError' | 'section' | 'page' | 'missing' | 'link' | 'notInNav',
    readonly label: string,
    readonly parent: DocsItem | undefined,
    /** Página ou arquivo do link (link externo: o endereço). */
    readonly uri?: vscode.Uri,
    readonly description?: string,
  ) {}
}

/**
 * Árvore "Documentação" (spec 02, LC6): as páginas do site escolhido, pelo `nav` do `mkdocs.yml` ou pelas
 * pastas. Com mais de um site (no workspace ou abertos do GitHub), um de cada vez: o nó do site no topo tem o
 * "Trocar", e abrir uma página de outro site troca sozinho; sem nenhum escolhido, a tela pede a escolha.
 * Clicar abre a página como o resto do VS Code (ou no visual, com `techdocsEditor.openVisualByDefault`); a
 * página aberta fica selecionada na árvore.
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
  /** Os sites do seletor, da última montagem. */
  private candidates: SiteCandidate[] = [];
  private currentKey: string | undefined;
  /** Página aberta de outro site, ainda por seguir (o site dela pode entrar na lista só na próxima montagem). */
  private follow: vscode.Uri | undefined;

  constructor(
    private readonly sites: LocalSites,
    private readonly remotes: RemoteRepos,
    private readonly state?: vscode.Memento,
  ) {
    this.currentKey = state?.get<string>(CURRENT_KEY);
    // Ao abrir o VS Code, o site da página que estava aberta
    this.follow = activeUri();
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
      vscode.window.tabGroups.onDidChangeTabs(() => {
        this.followActive();
        this.revealActive();
      }),
      this.view.onDidChangeVisibility(() => this.revealActive()),
    );
    this.ready = sites.ready.then(() => this.refresh());
  }

  getTreeItem(item: DocsItem): vscode.TreeItem {
    const collapsible = item.children.length
      ? (item.kind === 'site' || item.kind === 'remote') && !item.parent
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

  /**
   * "Trocar documentação": a lista dos sites agrupada pelo repositório, mais abrir do GitHub, abrir outra pasta
   * e escolher quais sites do workspace aparecem.
   */
  async chooseSite() {
    await this.ready;
    const candidates = [...this.candidates].sort((a, b) => a.repo.localeCompare(b.repo) || a.label.localeCompare(b.label));
    if (testSitePick) {
      const key = testSitePick(candidates);
      if (key) await this.select(key);
      return;
    }
    type Item = vscode.QuickPickItem & { key?: string; command?: string };
    const items: Item[] = [];
    let repo: string | undefined;
    for (const candidate of candidates) {
      if (candidate.repo !== repo) items.push({ label: candidate.repo, kind: vscode.QuickPickItemKind.Separator });
      repo = candidate.repo;
      // O repositório já está no separador: só a pasta dentro dele
      const folder = !candidate.local
        ? candidate.description
        : candidate.description.startsWith(`${candidate.repo}/`)
          ? candidate.description.slice(candidate.repo.length + 1)
          : candidate.description === candidate.repo
            ? ''
            : candidate.description;
      const showing = candidate.key === this.currentKey;
      items.push({
        label: `$(${showing ? 'check' : candidate.remote ? 'github' : 'book'}) ${candidate.label}`,
        description: [folder, showing ? vscode.l10n.t('showing now') : ''].filter(Boolean).join(' · '),
        key: candidate.key,
      });
    }
    items.push(
      { label: vscode.l10n.t('More'), kind: vscode.QuickPickItemKind.Separator },
      { label: `$(new-folder) ${vscode.l10n.t('Create documentation in a folder…')}`, command: 'newSiteInFolder' },
      { label: `$(github) ${vscode.l10n.t('Open from GitHub by link…')}`, command: 'techdocsEditor.openRemote' },
      { label: `$(folder-opened) ${vscode.l10n.t('Open another folder…')}`, command: 'workbench.action.files.openFolder' },
    );
    if (this.sites.all().length > 1) {
      items.push({ label: `$(list-filter) ${vscode.l10n.t('Choose which sites of this workspace appear…')}`, command: 'techdocsEditor.chooseSites' });
    }
    const chosen = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t('Documentation to edit'),
      placeHolder: vscode.l10n.t('Filter by name or folder'),
      matchOnDescription: true,
    });
    if (chosen?.key) await this.select(chosen.key);
    else if (chosen?.command === 'newSiteInFolder') await newSiteInFolder();
    else if (chosen?.command) await vscode.commands.executeCommand(chosen.command);
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
    if (current?.local) {
      const { mkdocs, site, yml } = current.local;
      const docsDir = mkdocs.with({ path: site.docsDir });
      // Um site só no workspace: as páginas direto, sem o nó do site
      const parent = candidates.length === 1 ? undefined : new DocsItem('site', current.label, undefined, docsDir, current.description);
      if (parent) parent.siteRoot = mkdocs.with({ path: site.root });
      const items = await this.siteItems(yml, site, docsDir, parent, pages);
      if (parent) {
        parent.children.push(...items);
        roots.push(parent);
      } else roots.push(...items);
    } else if (current?.remote) {
      roots.push(await this.remoteItem(current.remote, pages));
    }
    if (run !== this.runs) return this.latest;
    this.candidates = candidates;
    if (followed) this.follow = undefined;
    if (current && current.key !== this.currentKey) this.setCurrent(current.key);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.needsSite', candidates.length > 1 && !current);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.manySites', candidates.length > 1);
    this.roots = roots;
    this.pages = pages;
    this.changeEmitter.fire();
    this.revealActive();
  }

  /** Os sites do workspace (os escolhidos em `techdocsEditor.sites`) e os abertos do GitHub. */
  private async loadCandidates(): Promise<SiteCandidate[]> {
    const local = await Promise.all(
      this.sites.list().map(async ({ mkdocs, site }): Promise<SiteCandidate> => {
        const yml = await readText(mkdocs);
        const root = mkdocs.with({ path: site.root });
        return {
          key: mkdocs.toString(),
          label: siteName(yml) ?? site.root.split('/').pop()!,
          description: vscode.workspace.asRelativePath(root),
          repo: await repoOf(root),
          local: { mkdocs, site, yml },
        };
      }),
    );
    const remote = this.remotes.list().map((entry): SiteCandidate => {
      const where = entry.root ? `${entry.slug}/${entry.root}` : entry.slug;
      return { key: remoteKey(entry), label: this.remoteNames.get(remoteKey(entry)) ?? where, description: where, repo: `${entry.host}/${entry.slug}`, remote: entry };
    });
    return [...local, ...remote];
  }

  /** Nomes dos sites do GitHub, lidos ao montar a árvore deles. */
  private readonly remoteNames = new Map<string, string>();

  private setCurrent(key: string) {
    this.currentKey = key;
    void this.state?.update(CURRENT_KEY, key);
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
      this.remoteNames.set(remoteKey(entry), site.name);
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

/**
 * "Criar documentação numa pasta…": a pasta (uma vazia, por exemplo) e o "Novo site de documentação" nela; o
 * site criado entra na lista e a página inicial aberta o mostra na árvore.
 */
async function newSiteInFolder() {
  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Choose the folder for the new documentation'),
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Create the documentation here'),
  });
  const folder = picked?.[0];
  if (!folder) return;
  const created = await vscode.commands.executeCommand<{ mkdocs: vscode.Uri } | undefined>('techdocsEditor.newSite', folder);
  // Fora do workspace a extensão não vê o site: oferece abrir a pasta
  if (!created || vscode.workspace.getWorkspaceFolder(folder)) return;
  const open = vscode.l10n.t('Open the folder');
  const answer = await vscode.window.showInformationMessage(
    vscode.l10n.t('The documentation was created in {0}, outside this workspace. Open that folder to edit it.', folder.fsPath),
    open,
  );
  if (answer === open) await vscode.commands.executeCommand('vscode.openFolder', folder, { forceNewWindow: true });
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

function remoteKey(entry: RemoteEntry) {
  return `remote:${entry.host}/${entry.slug}/${entry.root}`;
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
