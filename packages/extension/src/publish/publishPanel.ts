import * as vscode from 'vscode';
import { DEFAULT_BRANCH_PATTERN, DEFAULT_LINT_CONFIG, parseGitHubRemote, parseRepoConfig, REPO_CONFIG_FILE, RepoConfig, VerificationMode } from '@edtroleis/techdocs-editor-core';
import type { LintService } from '../lintService';
import type { LocalSites } from '../localSites';
import { VisualEditorProvider } from '../visualEditorProvider';
import { GitHubTransport } from '@edtroleis/techdocs-editor-core';
import { clientFor, gitHubErrorText, hasSession, useTestTransport } from './githubAuth';
import { LocalPublisher, PublishConfig, PublishView } from './localPublisher';
import { DocumentPage, gitApi, VscodeGit } from './vscodeGit';

/** O que o webview do painel desenha. */
export type PanelState =
  | { status: 'off' | 'noPage' | 'noGit' | 'noRemote' | 'loading' }
  | { status: 'signIn'; host: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: PublishView };

export type PanelMessage =
  | { type: 'ready' }
  | { type: 'action'; action: 'saveDraft' | 'saveAndVerify' | 'send' | 'discard' | 'signIn' | 'refresh' }
  | { type: 'openUrl'; url: string }
  | { type: 'showLine'; path: string; line: number };

const CONFIG = 'techdocsEditor';

/**
 * Painel "Publicação" (LC5): opcional no modo local (`techdocsEditor.local.publishPanel`). Acompanha a
 * página de docs ativa (no editor visual ou no texto) e liga o `LocalPublisher` ao clone e ao GitHub.
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
  ) {
    this.updateContext();
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.follow()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.follow()),
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
  }

  /** Página de docs ativa: o editor de texto ou o editor visual em foco. */
  private activeDocument(): vscode.TextDocument | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri =
      input instanceof vscode.TabInputCustom && input.viewType === VisualEditorProvider.viewType
        ? input.uri
        : vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file' || !this.sites.siteOf(uri)) return undefined;
    return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  }

  /** Troca de página ativa: novo controlador. Sair para outro arquivo mantém a última página. */
  private follow() {
    if (!this.enabled) return this.setState({ status: 'off' });
    const document = this.activeDocument();
    if (!document) {
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
      const publisher = new LocalPublisher({
        git,
        page,
        client: clientFor(remote.host, remote.slug),
        lintConfig: async () => (await this.lint.configFor(document.uri)) ?? DEFAULT_LINT_CONFIG,
        config: publishConfig(repoConfig),
        l10n: vscode.l10n,
        confirm: async (message, action) =>
          testConfirm ?? (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action,
        errorText: error => gitHubErrorText(error, vscode.l10n),
        onChange: view => this.publisher === publisher && this.setState({ status: 'ready', view }),
      });
      this.publisher = publisher;
      await publisher.load();
      publisher.setFocused(vscode.window.state.focused);
      this.setState({ status: 'ready', view: publisher.view() });
    } catch (error) {
      this.setState({ status: 'error', message: gitHubErrorText(error, vscode.l10n) });
    }
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
    }
  }

  /** "Ver linha" de um apontamento da pipeline: o texto Markdown na linha. */
  private async showLine(path: string, line: number) {
    const api = await gitApi();
    const key = this.key ? vscode.Uri.parse(this.key) : undefined;
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

/** Settings do painel; `verification.*` do repositório vence as settings (spec 02, Configuração). */
function publishConfig(repo: RepoConfig | undefined): PublishConfig {
  const settings = vscode.workspace.getConfiguration(CONFIG);
  const seconds = (key: string, fallback: number) => Math.max(1, settings.get<number>(key, fallback)) * 1000;
  return {
    branchPattern: settings.get<string>('branchPattern') || DEFAULT_BRANCH_PATTERN,
    skipCi: settings.get<boolean>('drafts.skipCi', true),
    verificationMode: repo?.verification.mode ?? settings.get<VerificationMode>('verification.mode', 'auto'),
    startTimeoutMs: (repo?.verification.startTimeoutSeconds ?? settings.get<number>('verification.startTimeoutSeconds', 120)) * 1000,
    pollMs: seconds('polling.intervalSeconds', 8),
    idlePollMs: seconds('polling.idleIntervalSeconds', 60),
    checkHelp: { ...settings.get<Record<string, string>>('verification.checkHelp', {}), ...repo?.verification.checkHelp },
    language: vscode.env.language,
  };
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
