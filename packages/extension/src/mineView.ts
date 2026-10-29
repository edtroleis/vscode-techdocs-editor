import * as vscode from 'vscode';
import { listMyDrafts, MyDraft, parseGitHubRemote } from '@edtroleis/techdocs-editor-core';
import type { LocalSites } from './localSites';
import { authProviderFor, configuredScopes, gitHubErrorText, hasSession, usingTestTransport } from './publish/githubAuth';
import { publishConfig } from './publish/publishConfig';
import { gitApi } from './publish/vscodeGit';
import type { RemoteOpener } from './remote/openRemote';
import { remoteUri } from './remote/remoteFs';
import type { RemoteRepos } from './remote/remoteRepos';

export const MINE_VIEW = 'techdocsEditor.mine';
const REFRESH_DELAY_MS = 500;

/** Um rascunho na lista, com o repositório dele. */
export class MineItem {
  constructor(
    readonly draft: MyDraft,
    readonly host: string,
    readonly slug: string,
    /** O clone do repositório no workspace, se houver. */
    readonly root?: vscode.Uri,
  ) {}

  /** Endereço da página no rascunho (abrir: o clone do workspace, se houver, ou o GitHub). */
  get url() {
    return `https://${this.host}/${this.slug}/blob/${this.draft.branch}/${this.draft.page}`;
  }
}

/**
 * "Minhas alterações": as páginas que a pessoa está mudando, em todos os repositórios que a extensão conhece
 * (os sites abertos do GitHub e os clones do workspace), com o estado de cada uma. Só com login no GitHub:
 * a lista nunca pede o login.
 */
export class MineView implements vscode.TreeDataProvider<MineItem>, vscode.Disposable {
  private items: MineItem[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly onDidLoadEmitter = new vscode.EventEmitter<void>();
  /** A lista foi lida de novo. */
  readonly onDidLoad = this.onDidLoadEmitter.event;
  private readonly view: vscode.TreeView<MineItem>;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private runs = 0;
  /** Última leitura (os testes esperam por ela). */
  ready: Promise<void> = Promise.resolve();

  constructor(
    private readonly sites: LocalSites,
    private readonly remotes: RemoteRepos,
    private readonly opener: RemoteOpener,
  ) {
    this.view = vscode.window.createTreeView(MINE_VIEW, { treeDataProvider: this });
    this.disposables.push(
      this.view,
      this.changeEmitter,
      this.onDidLoadEmitter,
      remotes.onDidChange(() => this.refreshLater()),
      sites.onDidChange(() => this.refreshLater()),
      this.view.onDidChangeVisibility(() => this.view.visible && this.refreshLater()),
    );
    this.ready = sites.ready.then(() => this.refresh());
  }

  getTreeItem(item: MineItem): vscode.TreeItem {
    const { draft } = item;
    const tree = new vscode.TreeItem(draft.page.split('/').pop()!.replace(/\.md$/i, ''));
    const state = draft.state === 'review' ? vscode.l10n.t('In review') : vscode.l10n.t('Draft');
    tree.description = `${state} · ${item.slug}`;
    tree.tooltip = new vscode.MarkdownString(
      [`**${state}**`, `${item.slug}: \`${draft.page}\``, draft.pr ? vscode.l10n.t('Review request #{0}', draft.pr.number) : '']
        .filter(Boolean)
        .join('\n\n'),
    );
    tree.iconPath = new vscode.ThemeIcon(draft.state === 'review' ? 'eye' : 'edit');
    tree.contextValue = draft.pr ? 'mineWithPr' : 'mine';
    tree.command = { command: 'techdocsEditor.openMine', title: vscode.l10n.t('Open'), arguments: [item] };
    return tree;
  }

  getChildren(item?: MineItem): MineItem[] {
    return item ? [] : this.items;
  }

  /** Os rascunhos com o arquivo de cada um: no clone do workspace e no GitHub (para marcar os sites na lista). */
  draftRefs() {
    return this.items.map(item => ({
      state: item.draft.state,
      uris: [...(item.root ? [vscode.Uri.joinPath(item.root, item.draft.page)] : []), remoteUri(item.host, item.slug, item.draft.page)],
    }));
  }

  /** A lista (testes). */
  get list(): readonly MineItem[] {
    return this.items;
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposables.forEach(d => d.dispose());
  }

  /** Abre a página do rascunho (no editor visual, se for do GitHub). */
  open(item: MineItem) {
    return this.opener.fromInput(item.url);
  }

  /** "Abrir no GitHub" do pedido de revisão. */
  openPr(item: MineItem) {
    if (item.draft.pr) return vscode.env.openExternal(vscode.Uri.parse(item.draft.pr.url));
  }

  /** "Entrar no GitHub" da lista vazia: o login no servidor dos repositórios (o primeiro), e a lista de novo. */
  async signIn() {
    const repos = await this.repositories();
    const host = repos[0]?.host ?? (vscode.workspace.getConfiguration('techdocsEditor').get<string>('github.host')?.trim().toLowerCase() || 'github.com');
    await vscode.authentication.getSession(authProviderFor(host), configuredScopes(), { createIfNone: true });
    this.remotes.refresh();
    return this.refresh();
  }

  refresh(): Promise<void> {
    const run = ++this.runs;
    this.ready = this.load(run);
    return this.ready;
  }

  /** Depois de salvar ou enviar: a lista acompanha, sem ler a cada tecla. */
  refreshLater() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), REFRESH_DELAY_MS);
  }

  private async load(run: number) {
    const repos = await this.repositories();
    const config = publishConfig(vscode.workspace.getConfiguration('techdocsEditor'), undefined, vscode.env.language);
    const errors: string[] = [];
    const lists = await Promise.all(
      repos.map(async ({ host, slug, root }) => {
        if (!usingTestTransport() && !(await hasSession(host))) return [];
        try {
          const access = await this.remotes.access(host, slug);
          if (!access.login) return [];
          const drafts = await listMyDrafts(access.client, {
            login: access.login,
            defaultBranch: access.repo.defaultBranch,
            pattern: config.branchPattern,
            isPage: path => /\.md$/i.test(path),
          });
          return drafts.map(draft => new MineItem(draft, host, slug, root));
        } catch (error) {
          errors.push(`${slug}: ${gitHubErrorText(error, vscode.l10n)}`);
          return [];
        }
      }),
    );
    if (run !== this.runs) return;
    this.items = lists.flat();
    this.view.badge = this.items.length ? { value: this.items.length, tooltip: vscode.l10n.t('{0} pages being changed', this.items.length) } : undefined;
    this.view.message = errors.length ? vscode.l10n.t('Could not read: {0}', errors.join('; ')) : undefined;
    // A seção só aparece quando há o que mostrar
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.hasMine', this.items.length > 0);
    this.onDidLoadEmitter.fire();
    this.changeEmitter.fire();
  }

  /** Os repositórios do GitHub conhecidos: os dos sites abertos e os remotes dos clones com sites. */
  private async repositories(): Promise<Array<{ host: string; slug: string; root?: vscode.Uri }>> {
    const found = new Map<string, { host: string; slug: string; root?: vscode.Uri }>();
    const add = (host: string, slug: string, root?: vscode.Uri) => {
      const key = `${host}/${slug.toLowerCase()}`;
      found.set(key, { host, slug, root: root ?? found.get(key)?.root });
    };
    for (const entry of this.remotes.list()) add(entry.host, entry.slug);
    const api = await gitApi().catch(() => undefined);
    for (const { mkdocs } of this.sites.list()) {
      const repository = api?.getRepository(mkdocs);
      const url = repository?.state.remotes.find(r => r.name === 'origin')?.fetchUrl ?? repository?.state.remotes[0]?.fetchUrl;
      const remote = url ? parseGitHubRemote(url) : undefined;
      if (remote) add(remote.host, remote.slug, repository?.rootUri);
    }
    return [...found.values()];
  }
}
