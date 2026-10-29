import * as vscode from 'vscode';
import {
  branchFor,
  commitResolution,
  DEFAULT_LINT_CONFIG,
  GitHubClient,
  parseGitHubRemote,
  parseRemoteUri,
  parseRepoConfig,
  REMOTE_SCHEME,
  REPO_CONFIG_FILE,
  RepoConfig,
  syncWithMain,
} from '@edtroleis/techdocs-editor-core';
import type { Configuration } from 'markdownlint';
import type { LintService } from '../lintService';
import type { LocalSites } from '../localSites';
import { conflictTitle, type ConflictPanel } from '../remote/conflictPanel';
import { remoteUri, type RemoteFileSystem } from '../remote/remoteFs';
import type { RemoteRepos } from '../remote/remoteRepos';
import { VisualEditorProvider } from '../visualEditorProvider';
import { GitHubTransport } from '@edtroleis/techdocs-editor-core';
import { clientFor, gitHubErrorText, hasSession, useTestTransport } from './githubAuth';
import { LocalPublisher, LocalPublisherOptions, PublishView } from './localPublisher';
import { publishConfig } from './publishConfig';
import { RemoteGit } from './remoteGit';
import type { LocalGit, PageDoc } from './types';
import { DocumentPage, gitApi, VscodeGit } from './vscodeGit';

/** O que o webview do painel desenha. */
export type PanelState =
  | { status: 'off' | 'noPage' | 'noGit' | 'noRemote' | 'loading' }
  | { status: 'signIn'; host: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: PublishView };

export type PanelMessage =
  | { type: 'ready' }
  | { type: 'action'; action: 'saveDraft' | 'saveAndVerify' | 'send' | 'discard' | 'signIn' | 'refresh' | 'setUp' | 'resolve' }
  | { type: 'openUrl'; url: string }
  | { type: 'showLine'; path: string; line: number };

const CONFIG = 'techdocsEditor';

/**
 * Painel "Publicação" (LC5): opcional no modo local (`techdocsEditor.local.publishPanel`); sempre nas páginas
 * abertas do GitHub (4d). Acompanha a página de docs ativa (no editor visual ou no texto) e liga o
 * `LocalPublisher` ao clone e ao GitHub, ou ao GitHub só pela API (`RemoteGit`).
 */
export class PublishPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'techdocsEditor.publish';

  private view: vscode.WebviewView | undefined;
  private publisher: LocalPublisher | undefined;
  /** Página e repositório do `publisher` atual. */
  private key: string | undefined;
  private state: PanelState = { status: 'noPage' };
  private readonly disposables: vscode.Disposable[] = [];
  private loading: Promise<void> = Promise.resolve();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sites: LocalSites,
    private readonly lint: LintService,
    private readonly remotes: RemoteRepos,
    private readonly remoteFs: RemoteFileSystem,
    private readonly conflicts: ConflictPanel,
  ) {
    this.updateContext();
    this.disposables.push(
      remotes.onDidChange(() => this.updateContext()),
      vscode.window.onDidChangeActiveTextEditor(() => this.follow()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.follow()),
      // A página do GitHub abre a aba antes de o texto chegar: o documento aparece depois
      vscode.workspace.onDidOpenTextDocument(() => this.follow()),
      vscode.window.onDidChangeWindowState(state => this.publisher?.setFocused(state.focused)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration(CONFIG)) return;
        this.updateContext();
        this.reset();
      }),
    );
  }

  /** Para os testes de integração: o controlador da página atual, depois de carregar. */
  async current(): Promise<LocalPublisher | undefined> {
    await this.loading;
    return this.publisher;
  }

  /**
   * Para os testes de integração (o bundle dos testes tem a sua própria cópia dos módulos): GitHub
   * simulado no lugar da API e da sessão do VS Code, e a resposta das confirmações.
   */
  useTestGitHub(transport: ((host: string) => GitHubTransport) | undefined, confirm?: boolean) {
    useTestTransport(transport);
    testSession = Boolean(transport);
    testConfirm = confirm;
  }

  get panelState(): PanelState {
    return this.state;
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((message: PanelMessage) => this.onMessage(message), undefined, this.disposables);
    view.onDidChangeVisibility(() => view.visible && this.follow());
    this.follow();
  }

  dispose() {
    this.publisher?.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  private get enabled() {
    return vscode.workspace.getConfiguration(CONFIG).get<boolean>('local.publishPanel', false);
  }

  private updateContext() {
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.publishPanel', this.enabled);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.remoteDocs', this.remotes.list().length > 0);
  }

  /** Página de docs ativa: o editor de texto ou o editor visual em foco. */
  private activeDocument(): vscode.TextDocument | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri =
      input instanceof vscode.TabInputCustom && input.viewType === VisualEditorProvider.viewType
        ? input.uri
        : vscode.window.activeTextEditor?.document.uri;
    if (!uri) return undefined;
    const isRemote = uri.scheme === REMOTE_SCHEME && /\.md$/i.test(uri.path);
    const isLocal = this.enabled && uri.scheme === 'file' && this.sites.siteOf(uri);
    if (!isRemote && !isLocal) return undefined;
    return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  }

  /** Troca de página ativa: novo controlador. Sair para outro arquivo mantém a última página. */
  private follow() {
    const document = this.activeDocument();
    if (!document) {
      if (!this.enabled && !this.key?.startsWith(`${REMOTE_SCHEME}:`)) return this.setState({ status: 'off' });
      if (!this.publisher) this.setState({ status: 'noPage' });
      return;
    }
    if (document.uri.toString() === this.key) return;
    this.key = document.uri.toString();
    this.loading = this.open(document, false);
  }

  private reset() {
    this.publisher?.dispose();
    this.publisher = undefined;
    this.key = undefined;
    this.follow();
  }

  private async open(document: vscode.TextDocument, signIn: boolean) {
    this.publisher?.dispose();
    this.publisher = undefined;
    this.setState({ status: 'loading' });
    if (document.uri.scheme === REMOTE_SCHEME) return this.openRemote(document, signIn);
    try {
      const api = await gitApi();
      const repository = api?.getRepository(document.uri);
      if (!repository) return this.setState({ status: 'noGit' });
      const git = new VscodeGit(repository);
      const remote = parseGitHubRemote(git.remoteUrl() ?? '');
      if (!remote) return this.setState({ status: 'noRemote' });
      // A-1: o login só é pedido quando a pessoa clica em entrar
      if (!signIn && !(await hasSession(remote.host)) && !testSession) return this.setState({ status: 'signIn', host: remote.host });
      const site = this.sites.siteOf(document.uri)!;
      const rootPath = repository.rootUri.path.replace(/\/$/, '');
      const inRepo = (path: string) => path.slice(rootPath.length + 1);
      const page = new DocumentPage(document, inRepo(document.uri.path), inRepo(vscode.Uri.file(site.docsDir).path));
      const repoConfig = await readRepoConfig(repository.rootUri);
      await this.start({
        git,
        page,
        host: remote.host,
        client: clientFor(remote.host, remote.slug),
        slug: remote.slug,
        lintConfig: async () => (await this.lint.configFor(document.uri)) ?? DEFAULT_LINT_CONFIG,
        repoConfig,
      });
    } catch (error) {
      this.setState({ status: 'error', message: gitHubErrorText(error, vscode.l10n) });
    }
  }

  /**
   * Página do GitHub (4d): o mesmo painel, com o `RemoteGit` no lugar do clone. Sem login, o painel oferece
   * entrar (A-1); entrando, a página é lida de novo, agora do rascunho da pessoa e podendo salvar.
   */
  private async openRemote(document: vscode.TextDocument, signIn: boolean) {
    const uri = document.uri;
    const target = parseRemoteUri(uri.authority, uri.path);
    if (!target) return this.setState({ status: 'noPage' });
    try {
      const access = await this.remotes.access(target.host, target.slug, { signIn });
      if (!access.login) return this.setState({ status: 'signIn', host: target.host });
      if (signIn || !this.remoteFs.session(uri)?.branch) {
        // Lida antes sem login: de novo, com o rascunho da pessoa e a permissão de escrita
        await this.remoteFs.reload(uri);
        await reopenVisual(uri);
      }
      const session = this.remoteFs.session(uri);
      if (!session) return this.setState({ status: 'noPage' });
      const config = publishConfig(vscode.workspace.getConfiguration(CONFIG), session.repoConfig, vscode.env.language);
      const draft = { branch: branchFor(access.login, session.filePath, config.branchPattern), base: access.repo.defaultBranch, filePath: session.filePath };
      const git = new RemoteGit({
        client: access.client,
        defaultBranch: access.repo.defaultBranch,
        draftBranch: draft.branch,
        remoteUrl: `https://${target.host}/${target.slug}.git`,
        session: () => this.remoteFs.session(uri)!,
        reload: () => this.remoteFs.reload(uri),
      });
      await git.refresh();
      await this.start({
        git,
        page: new DocumentPage(document, session.filePath, session.docsDir),
        host: target.host,
        slug: target.slug,
        client: access.client,
        lintConfig: async () => this.remoteFs.session(uri)?.lintConfig ?? DEFAULT_LINT_CONFIG,
        repoConfig: session.repoConfig,
        // 4e: o que foi publicado depois do rascunho entra nele; se mudou o mesmo trecho, a tela de conflito
        sync: async () => {
          const synced = await syncWithMain(access.client, draft);
          if (synced.kind === 'updated' && synced.pageChanged && !document.isDirty) await this.remoteFs.reload(uri);
          return synced;
        },
        resolve: async conflict => {
          if (document.isDirty) throw new Error(vscode.l10n.t('Save the page before resolving the conflict.'));
          const title = conflictTitle(document);
          const text = await this.conflicts.resolve(title, conflict.chunks, vscode.l10n.t('Published version'));
          if (text === undefined) return false;
          await commitResolution(access.client, draft, conflict, text, vscode.l10n.t('docs: merge the published version into "{0}"', title));
          await this.remoteFs.reload(uri);
          return true;
        },
      });
    } catch (error) {
      this.setState({ status: 'error', message: gitHubErrorText(error, vscode.l10n) });
    }
  }

  private async start(o: {
    git: LocalGit;
    page: PageDoc;
    host: string;
    slug: string;
    client: GitHubClient;
    lintConfig: () => Promise<Configuration>;
    repoConfig: RepoConfig | undefined;
    sync?: LocalPublisherOptions['sync'];
    resolve?: LocalPublisherOptions['resolve'];
  }) {
    const publisher = new LocalPublisher({
      git: o.git,
      page: o.page,
      client: o.client,
      workflowClient: async () => {
        const client = clientFor(o.host, o.slug, ['workflow']);
        // Pede o login com o escopo agora (A-3), antes de qualquer mudança no repositório
        await client.getLogin();
        return client;
      },
      lintConfig: o.lintConfig,
      config: publishConfig(vscode.workspace.getConfiguration(CONFIG), o.repoConfig, vscode.env.language),
      l10n: vscode.l10n,
      confirm: async (message, action) =>
        testConfirm ?? (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,
      errorText: error => gitHubErrorText(error, vscode.l10n),
      onChange: view => this.publisher === publisher && this.setState({ status: 'ready', view }),
      sync: o.sync,
      resolve: o.resolve,
    });
    this.publisher = publisher;
    await publisher.load();
    publisher.setFocused(vscode.window.state.focused);
    this.setState({ status: 'ready', view: publisher.view() });
  }

  private async onMessage(message: PanelMessage) {
    if (message.type === 'ready') return this.post();
    if (message.type === 'openUrl') return vscode.env.openExternal(vscode.Uri.parse(message.url));
    if (message.type === 'showLine') return this.showLine(message.path, message.line);
    const publisher = this.publisher;
    switch (message.action) {
      case 'signIn': {
        const document = this.activeDocument() ?? vscode.workspace.textDocuments.find(d => d.uri.toString() === this.key);
        if (document) this.loading = this.open(document, true);
        return this.loading;
      }
      case 'refresh':
        return publisher?.refreshChecks();
      case 'saveDraft':
        return publisher?.saveDraft();
      case 'saveAndVerify':
        return publisher?.saveAndVerify();
      case 'send':
        return publisher?.send();
      case 'discard':
        return publisher?.discard();
      case 'setUp':
        return publisher?.setUp();
      case 'resolve':
        return publisher?.resolveConflict();
    }
  }

  /** "Ver linha" de um apontamento da pipeline: o texto Markdown na linha. */
  private async showLine(path: string, line: number) {
    const key = this.key ? vscode.Uri.parse(this.key) : undefined;
    const remote = key?.scheme === REMOTE_SCHEME ? parseRemoteUri(key.authority, key.path) : undefined;
    if (remote) {
      const position = new vscode.Position(Math.max(0, line - 1), 0);
      await vscode.window.showTextDocument(remoteUri(remote.host, remote.slug, path), {
        selection: new vscode.Range(position, position),
        viewColumn: vscode.ViewColumn.Beside,
      });
      return;
    }
    const api = await gitApi();
    const root = key && api?.getRepository(key)?.rootUri;
    if (!root) return;
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    await vscode.window.showTextDocument(vscode.Uri.joinPath(root, path), {
      selection: new vscode.Range(position, position),
      viewColumn: vscode.ViewColumn.Beside,
    });
  }

  private setState(state: PanelState) {
    this.state = state;
    this.post();
  }

  private post() {
    void this.view?.webview.postMessage({ type: 'state', state: this.state, labels: panelLabels() });
  }

  private html(webview: vscode.Webview, media: vscode.Uri) {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js'));
    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${PANEL_CSS}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

/** Reabre o editor visual da página, se está aberto (o "só leitura" é decidido ao abrir). */
async function reopenVisual(uri: vscode.Uri) {
  const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(
    t => t.input instanceof vscode.TabInputCustom && t.input.viewType === VisualEditorProvider.viewType && t.input.uri.toString() === uri.toString(),
  );
  const dirty = vscode.workspace.textDocuments.some(d => d.uri.toString() === uri.toString() && d.isDirty);
  if (!tabs.length || dirty) return;
  await vscode.window.tabGroups.close(tabs);
  await vscode.commands.executeCommand('vscode.openWith', uri, VisualEditorProvider.viewType);
}

/** Transporte de teste ligado: não há sessão do VS Code a conferir. */
let testSession = false;
let testConfirm: boolean | undefined;

/** `.techdocs-editor.yaml` na raiz do clone (a cópia local da configuração da pipeline). */
async function readRepoConfig(root: vscode.Uri): Promise<RepoConfig | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, REPO_CONFIG_FILE));
    return parseRepoConfig(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** Textos do webview do painel (o webview não tem `vscode.l10n`). */
export function panelLabels() {
  return {
    noPage: vscode.l10n.t('Open a documentation page to publish it.'),
    noGit: vscode.l10n.t('This page is not in a Git repository.'),
    noRemote: vscode.l10n.t('The repository has no GitHub remote.'),
    loading: vscode.l10n.t('Loading…'),
    signIn: vscode.l10n.t('Sign in to GitHub'),
    signInHint: vscode.l10n.t('Publishing creates a branch and a pull request on GitHub.'),
    branch: vscode.l10n.t('Branch'),
    newBranch: vscode.l10n.t('Saving creates the branch {0} from {1}.'),
    saveDraft: vscode.l10n.t('Save draft'),
    saveDraftHint: vscode.l10n.t('Commit and push without running the checks'),
    saveAndVerify: vscode.l10n.t('Save and check'),
    saveAndVerifyHint: vscode.l10n.t('Fix the formatting, commit, push and run the automatic checks'),
    sendForPublication: vscode.l10n.t('Send for publication'),
    sendForReview: vscode.l10n.t('Send for review'),
    sendHint: vscode.l10n.t('Marks the pull request as ready. The page is published when the merge is done on GitHub.'),
    discard: vscode.l10n.t('Discard'),
    pullRequest: vscode.l10n.t('Pull request #{0}'),
    draftPr: vscode.l10n.t('draft'),
    published: vscode.l10n.t('Published: pull request #{0} was merged on GitHub.'),
    conflict: vscode.l10n.t('The published version of this page changed the same passages as your draft.'),
    resolve: vscode.l10n.t('Resolve conflict'),
    readyPr: vscode.l10n.t('ready'),
    unverified: vscode.l10n.t('Saved without checking. Save and check before sending.'),
    checks: vscode.l10n.t('Checks'),
    checksNone: vscode.l10n.t('Waiting for the checks to start…'),
    checksRunning: vscode.l10n.t('Checks running…'),
    checksPassed: vscode.l10n.t('All checks passed.'),
    checksFailed: vscode.l10n.t('Some checks failed. Fix the points below and save again.'),
    stalled: vscode.l10n.t('No check started on GitHub. Open the pull request to see why.'),
    editorChecks: vscode.l10n.t('This repository has no pipeline: the formatting check of the editor is the verification.'),
    line: vscode.l10n.t('Line {0}'),
    refresh: vscode.l10n.t('Refresh'),
    details: vscode.l10n.t('Details'),
    setupTitle: vscode.l10n.t('Repository setup'),
    setupMissing: vscode.l10n.t('Missing in this repository, for every change to be checked:'),
    setupWorkflow: vscode.l10n.t('automatic checks on pull requests'),
    setupMarkdownlint: vscode.l10n.t('file with the formatting rules'),
    setupMerge: vscode.l10n.t('merge by squash with the pull request message'),
    setupRuleset: vscode.l10n.t('protection of the main branch (changes only through a checked pull request)'),
    setupButton: vscode.l10n.t('Set up checks'),
  };
}

export type PanelLabels = ReturnType<typeof panelLabels>;

const PANEL_CSS = `
body { padding: 8px 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
p { margin: 6px 0; }
.muted { color: var(--vscode-descriptionForeground); }
.branch { font-family: var(--vscode-editor-font-family); word-break: break-all; }
.actions { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
button { padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; text-align: center; }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible, a:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
a { color: var(--vscode-textLink-foreground); cursor: pointer; }
.notice { border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground); padding-left: 8px; }
.error { border-left: 3px solid var(--vscode-errorForeground); padding-left: 8px; color: var(--vscode-errorForeground); }
ul { list-style: none; padding: 0; margin: 4px 0; }
li { margin: 4px 0; }
.check-failed { color: var(--vscode-testing-iconFailed); }
.check-passed { color: var(--vscode-testing-iconPassed); }
.check-running { color: var(--vscode-testing-iconQueued); }
.annotation { margin-left: 18px; }
`;
