import * as vscode from 'vscode';
import type { HostMessage, WebviewMessage } from './protocol';
import { rebase } from './rebase';
import { minimalEdit, toEol, toLf } from './textSync';

/**
 * Editor visual sobre o `TextDocument` do VS Code (spec 00, X4): o documento é a fonte da verdade.
 * O webview manda o texto novo a cada edição e o host aplica só o trecho alterado; mudanças vindas de
 * fora (editor de texto ao lado, desfazer do VS Code, git) voltam ao webview.
 */
export class VisualEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'techdocsEditor.visual';

  private readonly sessions = new Map<string, EditorSession>();
  private readonly onDidOpenEmitter = new vscode.EventEmitter<string>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const key = document.uri.toString();
    const session = new EditorSession(document, panel, this.extensionUri);
    this.sessions.set(key, session);
    panel.onDidDispose(() => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
      session.dispose();
    });
    this.onDidOpenEmitter.fire(key);
  }

  /** Para os testes: a sessão do arquivo, quando o editor visual dele terminou de carregar. */
  async session(uri: vscode.Uri, timeoutMs = 20_000): Promise<EditorSession> {
    const key = uri.toString();
    const opened =
      this.sessions.get(key) ??
      (await new Promise<EditorSession>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`editor visual não abriu: ${key}`)), timeoutMs);
        const listener = this.onDidOpenEmitter.event(opened => {
          if (opened !== key) return;
          clearTimeout(timer);
          listener.dispose();
          resolve(this.sessions.get(key)!);
        });
      }));
    await opened.ready;
    return opened;
  }
}

export class EditorSession {
  readonly ready: Promise<void>;
  private markReady!: () => void;
  private readonly disposables: vscode.Disposable[] = [];
  /** Último texto mandado pelo webview: a mudança que ele causa no documento não volta ao webview. */
  private lastFromWebview: string | undefined;
  /** As edições do webview são aplicadas uma de cada vez, na ordem em que chegaram. */
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  private readonly requests = new Map<number, (text: string) => void>();

  constructor(
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    this.ready = new Promise(resolve => (this.markReady = resolve));
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const pageDir = vscode.Uri.joinPath(document.uri, '..');
    panel.webview.options = {
      enableScripts: true,
      // Imagens da página: a pasta do workspace (ou só a da página, para arquivo solto)
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview'), folder?.uri ?? pageDir],
    };
    panel.webview.html = webviewHtml(panel.webview, extensionUri);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.receive(message)),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document !== document || event.contentChanges.length === 0) return;
        const text = toLf(document.getText());
        // Eco da própria edição do webview. Desfazer e refazer nunca são eco, mesmo quando voltam a um
        // texto que o webview mandou (refazer volta exatamente a ele)
        if (event.reason === undefined && text === this.lastFromWebview) return;
        this.post({ type: 'update', text });
      }),
    );
    this.pageDir = pageDir;
  }

  private readonly pageDir: vscode.Uri;

  /** Testes: o que o editor gravaria agora, no formato do arquivo. */
  saved(): Promise<string> {
    const id = this.nextRequest++;
    return new Promise(resolve => {
      this.requests.set(id, text => resolve(toEol(text, this.eol)));
      this.post({ type: 'test:getSaved', id });
    });
  }

  /** Testes: insere Markdown no cursor do editor visual. */
  insert(markdown: string) {
    this.post({ type: 'test:insert', markdown });
  }

  /** Testes: clica no botão da barra fixa do editor visual. */
  clickTopBar(index: number) {
    this.post({ type: 'test:clickTopBar', index });
  }

  /** Espera as edições recebidas do webview chegarem ao documento. */
  settled(): Promise<unknown> {
    return this.queue;
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  private get eol(): '\n' | '\r\n' {
    return this.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  }

  private post(message: HostMessage) {
    void this.panel.webview.postMessage(message);
  }

  private receive(message: WebviewMessage) {
    switch (message.type) {
      case 'loaded':
        this.post({
          type: 'init',
          text: toLf(this.document.getText()),
          language: vscode.env.language,
          baseUri: this.panel.webview.asWebviewUri(this.pageDir).toString(),
        });
        return;
      case 'ready':
        this.markReady();
        return;
      case 'edit':
        this.queue = this.queue.then(() => this.apply(message.before, message.after));
        return;
      case 'undo':
      case 'redo':
        // Na fila: a última edição do webview chega ao documento antes de desfazer. O comando age no
        // editor ativo, que tem de ser este (ver activated)
        this.queue = this.queue.then(async () => {
          if (await this.activated()) await vscode.commands.executeCommand(message.type);
        });
        return;
      case 'test:saved':
        this.requests.get(message.id)?.(message.text);
        this.requests.delete(message.id);
        return;
    }
  }

  /**
   * Espera o painel ficar ativo. O clique ou a tecla vieram do webview, mas o aviso de painel ativo
   * pode chegar ao host depois da mensagem (com o foco antes no texto ao lado, o desfazer se perdia).
   * Se não chegar logo, traz o painel para a frente; desiste depois de um tempo, para nunca desfazer
   * em outro editor.
   */
  private async activated(timeoutMs = 1_000): Promise<boolean> {
    if (this.panel.active) return true;
    const changed = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => {
        listener.dispose();
        resolve(this.panel.active);
      }, timeoutMs);
      const listener = this.panel.onDidChangeViewState(({ webviewPanel }) => {
        if (!webviewPanel.active) return;
        clearTimeout(timer);
        listener.dispose();
        resolve(true);
      });
    });
    setTimeout(() => {
      if (!this.panel.active) this.panel.reveal(this.panel.viewColumn, false);
    }, 200);
    return changed;
  }

  /**
   * Aplica a mudança do webview ao documento como ele está agora. Se o documento mudar no meio
   * (alguém digitando no texto ao lado), o VS Code recusa a edição: calcula de novo e tenta outra vez.
   */
  private async apply(before: string, after: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = toLf(this.document.getText());
      const text = rebase(before, after, current);
      if (text === current) return;
      this.lastFromWebview = text;
      // Trecho calculado no texto como está no arquivo (com o fim de linha dele)
      const file = this.document.getText();
      const { start, end, text: replacement } = minimalEdit(file, toEol(text, this.eol));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        this.document.uri,
        new vscode.Range(this.document.positionAt(start), this.document.positionAt(end)),
        replacement,
      );
      const applied = await vscode.workspace.applyEdit(edit);
      this.lastFromWebview = undefined;
      if (applied) {
        // Juntou com mudanças que o webview ainda não tinha: ele precisa do resultado
        if (text !== after) this.post({ type: 'update', text });
        return;
      }
    }
  }
}

function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', name));
  const nonce = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  // Estilos inline: o ProseMirror e o Crepe posicionam menus com `style`. Imagens externas (https) são
  // as que a própria página já usa; scripts só os do pacote, com nonce.
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${asset('main.css')}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}
