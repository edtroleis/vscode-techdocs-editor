import { itemPaths, sendSummary, type SendGroup, type SendItem, type SiteFinding } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import { findingMessage } from '../repoCheck';
import type { Sender, SendState } from './sender';
import { SEND_CSS } from './sendCss';
import { summaryText } from './summaryText';

/** O HTML de um webview do envio: o script e o estilo com nonce, nada de fora. */
export function webviewHtml(script: vscode.Uri, css: string) {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${css}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

/**
 * A tela de envio (spec 09, telas 2, 6 e 15): o que vai, agrupado por site, com Desfazer, a conferência antes e o
 * botão. O webview só desenha o estado e devolve os cliques; Git e GitHub ficam no host (A-6).
 */

export type SendCheck = { kind: 'ok' | 'fixable' | 'blocking'; text: string; path?: string; line?: number };
export type SendPanelState = {
  groups: SendGroup[];
  outside: string[];
  summary: string;
  checks: SendCheck[];
  primary: 'review' | 'publish';
  busy: boolean;
  message?: string;
};
export type SendPanelMessage =
  | { type: 'ready' }
  | { type: 'send'; summary: string }
  | { type: 'undo'; index: number }
  | { type: 'diff'; path: string }
  | { type: 'open'; path: string; line?: number }
  | { type: 'fix' }
  | { type: 'showOutside' }
  | { type: 'cancel' };

/** Os textos da tela, em inglês no código (o webview não tem `vscode.l10n`). Sem termos do Git (spec 09). */
export function sendLabels() {
  return {
    titleOne: vscode.l10n.t('Send 1 change to {0}'),
    titleMany: vscode.l10n.t('Send {0} changes to {1}'),
    titleSites: vscode.l10n.t('Send {0} changes from {1} sites'),
    subtitleReview: vscode.l10n.t('They go to review on GitHub. Once approved, they are in the documentation.'),
    subtitlePublish: vscode.l10n.t('They go straight to the documentation on GitHub.'),
    whatGoes: vscode.l10n.t('What goes'),
    changesOne: vscode.l10n.t('1 change'),
    changesMany: vscode.l10n.t('{0} changes'),
    kindModified: vscode.l10n.t('CHANGED'),
    kindAdded: vscode.l10n.t('NEW'),
    kindMoved: vscode.l10n.t('MOVED'),
    kindDeleted: vscode.l10n.t('REMOVED'),
    kindImages: vscode.l10n.t('IMAGES'),
    kindMenu: vscode.l10n.t('MENU'),
    kindSiteFile: vscode.l10n.t('SITE'),
    imagesUsed: vscode.l10n.t('{0} new images used in {1}'),
    imagesOne: vscode.l10n.t('1 new image'),
    imagesMany: vscode.l10n.t('{0} new images'),
    menu: vscode.l10n.t('Site menu'),
    viewChanges: vscode.l10n.t('See what changed'),
    viewPage: vscode.l10n.t('See the page'),
    undo: vscode.l10n.t('Undo'),
    outsideOne: vscode.l10n.t('1 file outside the documentation is not sent'),
    outsideMany: vscode.l10n.t('{0} files outside the documentation are not sent'),
    outsideHint: vscode.l10n.t('It stays only on your computer.'),
    seeWhich: vscode.l10n.t('See which'),
    summary: vscode.l10n.t('What changed'),
    check: vscode.l10n.t('Check'),
    allGood: vscode.l10n.t('All good: links, images, menu and formatting'),
    fix: vscode.l10n.t('Fix'),
    seeOnPage: vscode.l10n.t('See on the page'),
    sendForReview: vscode.l10n.t('Send for review'),
    publish: vscode.l10n.t('Publish'),
    cancel: vscode.l10n.t('Cancel'),
    blocked: vscode.l10n.t('Fix the problems above to send'),
    nothing: vscode.l10n.t('Nothing to send: every page is the same as on GitHub.'),
  };
}
export type SendLabels = ReturnType<typeof sendLabels>;

/** Achados da conferência de um site, já filtrados para o que vai no envio. */
export type SendConference = {
  findings: (paths: string[]) => Promise<SiteFinding[]>;
  fixAll: (findings: SiteFinding[]) => Promise<void>;
};

/** O que a tela de envio precisa do resto da extensão. */
export type SendPanelDeps = {
  sender: Sender;
  conference: SendConference;
  /** Caminho no repositório → arquivo no disco. */
  uri: (path: string) => vscode.Uri;
  /** O conteúdo do arquivo na branch principal do GitHub (para o diff). */
  original: (path: string) => vscode.Uri;
  /** Repositório (chave do painel) e nome para o título da aba. */
  key: string;
};

const checksOf = (findings: SiteFinding[]): SendCheck[] =>
  findings
    .filter(f => f.fix || f.severity === 'error')
    .map(f => ({ kind: f.fix ? 'fixable' : 'blocking', text: findingMessage(f), path: f.file, line: f.line }));

export class SendPanel implements vscode.Disposable {
  private static readonly open = new Map<string, SendPanel>();
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private findings: SiteFinding[] = [];
  private summary: string | undefined;
  private busy = false;

  /** Abre (ou traz para a frente) a tela de envio do repositório. */
  static show(extensionUri: vscode.Uri, deps: SendPanelDeps): SendPanel {
    const existing = SendPanel.open.get(deps.key);
    if (existing) {
      existing.panel.reveal();
      void existing.update();
      return existing;
    }
    const panel = new SendPanel(extensionUri, deps);
    SendPanel.open.set(deps.key, panel);
    return panel;
  }

  private constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: SendPanelDeps,
  ) {
    this.panel = vscode.window.createWebviewPanel('techdocsEditor.send', vscode.l10n.t('Send to the repository'), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    });
    this.panel.webview.html = this.html();
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((message: SendPanelMessage) => this.receive(message)),
    );
  }

  dispose() {
    SendPanel.open.delete(this.deps.key);
    this.disposables.forEach(d => d.dispose());
  }

  /** O estado do envio mudou (o Sender avisa): fecha ao enviar, redesenha no resto. */
  async stateChanged(state: SendState) {
    if (state.status === 'inReview' && !this.busy) return;
    if (state.status === 'inReview' || state.status === 'merged') {
      this.panel.dispose();
      return;
    }
    if (state.status === 'idle') await this.update();
    else this.post(this.view(state.status === 'error' ? state.message : undefined));
  }

  private items(): SendItem[] {
    const state = this.deps.sender.current;
    return state.status === 'idle' ? state.groups.flatMap(g => g.items) : [];
  }

  /** Recalcula a conferência das mudanças e redesenha. */
  async update() {
    const paths = this.items().flatMap(itemPaths);
    this.findings = paths.length ? await this.deps.conference.findings(paths).catch(() => []) : [];
    this.post(this.view());
  }

  private view(message?: string): SendPanelState {
    const state = this.deps.sender.current;
    const groups = state.status === 'idle' ? state.groups : [];
    return {
      groups,
      outside: state.status === 'idle' ? state.outside : [],
      summary: this.summary ?? sendSummary(groups, summaryText),
      checks: checksOf(this.findings),
      primary: state.status === 'idle' ? state.primary : 'review',
      busy: this.busy || state.status === 'sending',
      message,
    };
  }

  private post(state: SendPanelState) {
    void this.panel.webview.postMessage({ type: 'state', state, labels: sendLabels() });
  }

  private async receive(message: SendPanelMessage) {
    const { sender, uri, original } = this.deps;
    switch (message.type) {
      case 'ready':
        return this.update();
      case 'send':
        this.summary = message.summary;
        this.busy = true;
        try {
          await sender.send(message.summary);
        } finally {
          this.busy = false;
        }
        return this.stateChanged(sender.current);
      case 'undo': {
        const item = this.items()[message.index];
        if (item) await sender.undo(item);
        return this.update();
      }
      case 'diff':
        return vscode.commands.executeCommand('vscode.diff', original(message.path), uri(message.path), vscode.l10n.t('{0}: what changed', message.path));
      case 'open': {
        const editor = await vscode.window.showTextDocument(uri(message.path));
        if (message.line) {
          const position = new vscode.Position(message.line - 1, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position));
        }
        return undefined;
      }
      case 'fix':
        await this.deps.conference.fixAll(this.findings.filter(f => f.fix));
        await sender.refresh();
        return this.update();
      case 'showOutside': {
        const state = sender.current;
        if (state.status !== 'idle') return undefined;
        const pick = await vscode.window.showQuickPick(state.outside, { placeHolder: vscode.l10n.t('Files outside the documentation (not sent)') });
        if (pick) await vscode.window.showTextDocument(uri(pick));
        return undefined;
      }
      case 'cancel':
        this.panel.dispose();
        return undefined;
    }
  }

  private html() {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'send.js'));
    return webviewHtml(script, SEND_CSS);
  }
}
