import * as vscode from 'vscode';
import type { SendState } from './sender';
import { SEND_CSS } from './sendCss';
import { webviewHtml } from './sendPanel';
import type { SendService } from './sendService';

/**
 * O painel Envio (spec 09, telas 4, 9, 10 e 14), ao lado do editor: em que pé está o envio do repositório, em
 * linguagem simples, até entrar na branch principal. O webview só desenha.
 */

export type SendViewMessage =
  | { type: 'ready' }
  | { type: 'action'; action: 'send' | 'giveUp' | 'resolve' | 'continue' | 'refresh' }
  | { type: 'openUrl'; url: string }
  | { type: 'showLine'; path: string; line: number };

/** Os textos do painel, em inglês no código. Sem termos do Git (spec 09). */
export function sendViewLabels() {
  return {
    nothing: vscode.l10n.t('Nothing sent. When you finish, use Send to send your changes.'),
    toSend: vscode.l10n.t('{0} changes to send'),
    send: vscode.l10n.t('Send'),
    sending: vscode.l10n.t('Sending…'),
    sent: vscode.l10n.t('Sent'),
    seeOnGitHub: vscode.l10n.t('see on GitHub'),
    checking: vscode.l10n.t('Checking'),
    checked: vscode.l10n.t('Checked'),
    checkFailed: vscode.l10n.t('The check found a problem'),
    seeLine: vscode.l10n.t('See the line'),
    waitingReview: vscode.l10n.t('Waiting for review'),
    waitingApprovals: vscode.l10n.t('{0} approval from who takes care of the repository'),
    changesRequested: vscode.l10n.t('{0} asked for changes'),
    approved: vscode.l10n.t('Approved by {0}'),
    inDocs: vscode.l10n.t('In the documentation'),
    pendingOne: vscode.l10n.t('1 page with a new change'),
    pendingMany: vscode.l10n.t('{0} pages with a new change'),
    sendAgain: vscode.l10n.t('Send again'),
    continueEditing: vscode.l10n.t('Continue editing'),
    giveUp: vscode.l10n.t('Give up this send'),
    merged: vscode.l10n.t('Approved and in the documentation'),
    mergedBy: vscode.l10n.t('Approved by {0} and in the documentation'),
    mergedHint: vscode.l10n.t('Your copy was updated with GitHub.'),
    conflict: vscode.l10n.t('The same part changed on GitHub and here'),
    conflictHint: vscode.l10n.t('Choose what stays in each file. Nothing is sent until you choose.'),
    choose: vscode.l10n.t('Choose'),
    offline: vscode.l10n.t('No internet right now'),
    offlineHint: vscode.l10n.t('Your changes are saved on this computer. They are sent when the connection is back.'),
    cannotWrite: vscode.l10n.t('You cannot send to this repository'),
    cannotWriteHint: vscode.l10n.t('Your GitHub account can only read it. Your changes stay saved on this computer.'),
    copyLink: vscode.l10n.t('Copy the repository link'),
    error: vscode.l10n.t('Not sent'),
    tryAgain: vscode.l10n.t('Try again'),
  };
}
export type SendViewLabels = ReturnType<typeof sendViewLabels>;

export class SendView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'techdocsEditor.envio';
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly send: SendService,
  ) {
    this.disposables.push(send.onDidChange(() => this.post()));
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')] };
    view.webview.html = webviewHtml(view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sendView.js')), SEND_CSS);
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: SendViewMessage) => this.receive(message)),
      view.onDidDispose(() => (this.view = undefined)),
    );
  }

  private post() {
    const repo = this.send.repoOf();
    const state: SendState | undefined = repo?.state;
    void this.view?.webview.postMessage({ type: 'state', state, count: repo?.count ?? 0, labels: sendViewLabels() });
  }

  private async receive(message: SendViewMessage) {
    const repo = this.send.repoOf();
    switch (message.type) {
      case 'ready':
        return this.post();
      case 'openUrl':
        return vscode.env.openExternal(vscode.Uri.parse(message.url));
      case 'showLine': {
        if (!repo) return undefined;
        const editor = await vscode.window.showTextDocument(vscode.Uri.joinPath(repo.root, message.path));
        const position = new vscode.Position(Math.max(0, message.line - 1), 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
        return undefined;
      }
      case 'action':
        if (message.action === 'continue') return vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        if (message.action === 'refresh') return this.send.refresh();
        if (message.action === 'resolve' && repo?.state?.status === 'cannotWrite') {
          await vscode.env.clipboard.writeText(repo.state.repoUrl);
          return vscode.window.showInformationMessage(vscode.l10n.t('Link copied.'));
        }
        return repo && this.send.action(repo.root, message.action);
    }
  }
}
