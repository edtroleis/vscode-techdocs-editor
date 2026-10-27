import * as vscode from 'vscode';
import type { HostMessage, WebviewMessage } from './protocol';
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
        if (text === this.lastFromWebview) return;
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
        this.queue = this.queue.then(() => this.apply(message.text));
        return;
      case 'test:saved':
        this.requests.get(message.id)?.(message.text);
        this.requests.delete(message.id);
        return;
    }
  }

  private async apply(text: string) {
    const current = toLf(this.document.getText());
    if (text === current) return;
    this.lastFromWebview = text;
    // Trecho calculado no texto como está no arquivo (com o fim de linha dele)
    const before = this.document.getText();
    const { start, end, text: replacement } = minimalEdit(before, toEol(text, this.eol));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.document.uri,
      new vscode.Range(this.document.positionAt(start), this.document.positionAt(end)),
      replacement,
    );
    await vscode.workspace.applyEdit(edit);
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
