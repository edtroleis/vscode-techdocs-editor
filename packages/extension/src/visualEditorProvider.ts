import * as vscode from 'vscode';
import { parseRemoteUri, REMOTE_SCHEME, remoteUriPath } from '@edtroleis/techdocs-editor-core';
import type { LintService } from './lintService';
import type { LocalSites } from './localSites';
import type { RemoteFileSystem } from './remote/remoteFs';
import { DEFAULT_MAX_IMAGE_MB, imageProblem, imageTarget } from './imageUpload';
import type { HostMessage, LinkPageView, WebviewLabels, WebviewMessage } from './protocol';
import type { Strip, StripAction } from './publish/strip';
import { hasConflictMarkers } from './docsSite';
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
  /** Faixa de estado de cada página, vinda do painel de publicação. */
  private readonly strips = new Map<string, Strip | undefined>();
  private readonly onStripActionEmitter = new vscode.EventEmitter<{ uri: vscode.Uri; action: StripAction }>();
  /** Clique num botão da faixa de estado. */
  readonly onStripAction = this.onStripActionEmitter.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly lint: LintService,
    private readonly sites: LocalSites,
    private readonly remoteFs?: RemoteFileSystem,
  ) {}

  /** Páginas do site de uma página, para a caixa de link (a árvore da Documentação, que já as conhece). */
  linkPages: (uri: vscode.Uri) => LinkPageView[] = () => [];

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const key = document.uri.toString();
    const session = new EditorSession(document, panel, this.extensionUri, this.lint, this.sites, this.remoteFs, {
      strip: () => this.strips.get(key),
      action: action => this.onStripActionEmitter.fire({ uri: document.uri, action }),
      linkPages: () => this.linkPages(document.uri),
    });
    this.sessions.set(key, session);
    panel.onDidDispose(() => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
      session.dispose();
    });
    this.onDidOpenEmitter.fire(key);
  }

  /** Mostra a faixa de estado no editor visual da página (se aberto, e quando abrir). */
  setStrip(uri: vscode.Uri, strip: Strip | undefined) {
    const key = uri.toString();
    this.strips.set(key, strip);
    this.sessions.get(key)?.showStrip(strip);
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
  /** O webview mostra o aviso de conflito em vez do editor (spec 02, LC4). */
  conflicted = false;
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
    private readonly lint: LintService,
    private readonly sites: LocalSites,
    private readonly remoteFs?: RemoteFileSystem,
    private readonly status?: { strip(): Strip | undefined; action(action: StripAction): void; linkPages?(): LinkPageView[] },
  ) {
    this.ready = new Promise(resolve => (this.markReady = resolve));
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const pageDir = vscode.Uri.joinPath(document.uri, '..');
    const remote = document.uri.scheme === REMOTE_SCHEME ? parseRemoteUri(document.uri.authority, document.uri.path) : undefined;
    panel.webview.options = {
      enableScripts: true,
      // Imagens da página: a pasta do workspace, o repositório do GitHub (lidas pelo esquema `techdocs:`) ou
      // só a pasta da página, para arquivo solto
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        remote ? document.uri.with({ path: remoteUriPath(remote.slug, '') }) : (folder?.uri ?? pageDir),
      ],
    };
    panel.webview.html = webviewHtml(panel.webview, extensionUri);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.receive(message)),
      lint.onDidLint(({ uri, problems }) => {
        if (uri.toString() === document.uri.toString()) this.post({ type: 'lint', problems });
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document !== document || event.contentChanges.length === 0) return;
        const text = toLf(document.getText());
        const conflicted = hasConflictMarkers(text);
        if (conflicted !== this.conflicted) {
          // Conflito apareceu (git merge com a página aberta) ou foi resolvido: troca o editor pelo aviso
          // ou o aviso pelo editor, com o texto de agora
          this.sendContent();
          return;
        }
        if (conflicted) return;
        // Eco da própria edição do webview. Desfazer e refazer nunca são eco, mesmo quando voltam a um
        // texto que o webview mandou (refazer volta exatamente a ele)
        if (event.reason === undefined && text === this.lastFromWebview) return;
        this.post({ type: 'update', text });
      }),
    );
    this.pageDir = pageDir;
  }

  private readonly pageDir: vscode.Uri;

  /** A faixa de estado da página (rascunho, em revisão…); undefined esconde. */
  showStrip(strip: Strip | undefined) {
    this.post({ type: 'status', strip });
  }

  /** Seleciona o trecho no editor visual, com o foco nele. */
  select(text: string) {
    this.post({ type: 'select', text });
  }

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

  /** Testes: clica no elemento do webview que casar com o seletor. */
  click(selector: string) {
    this.post({ type: 'test:click', selector });
  }

  /** Testes: escolhe a imagem no primeiro bloco de imagem vazio do editor visual. */
  chooseImage(name: string, mime: string, data: Uint8Array) {
    this.post({ type: 'test:chooseImage', name, mime, data });
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
        this.sendContent();
        return;
      case 'openText':
        // Troca este editor pelo texto, no mesmo lugar
        void vscode.commands
          .executeCommand('vscode.openWith', this.document.uri, 'default', this.panel.viewColumn)
          .then(() => this.panel.dispose());
        return;
      case 'ready':
        this.post({ type: 'lint', problems: this.lint.problems(this.document.uri) });
        this.post({ type: 'status', strip: this.status?.strip() });
        this.markReady();
        return;
      case 'statusAction':
        this.status?.action(message.action);
        return;
      case 'fixLint':
        // Na fila: a última edição do webview chega ao documento antes da correção
        this.queue = this.queue.then(async () => {
          const edit = await this.lint.fixEdit(this.document);
          if (edit) await vscode.workspace.applyEdit(edit);
        });
        return;
      case 'showLine':
        void this.showLine(message.line);
        return;
      case 'linkPages':
        this.post({ type: 'linkPages', id: message.id, pages: this.status?.linkPages?.() ?? [] });
        return;
      case 'uploadImage':
        void this.uploadImage(message.name, message.mime, message.data).then(
          link => this.post({ type: 'uploaded', id: message.id, link }),
          (e: Error) => {
            // O editor descarta o erro do envio em silêncio: o aviso fica com o VS Code
            void vscode.window.showErrorMessage(e.message);
            this.post({ type: 'uploaded', id: message.id, error: e.message });
          },
        );
        return;
      case 'edit':
        if (this.conflicted) return;
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
      case 'save':
        // Na fila: grava só depois que a última edição do webview chegou ao documento
        this.queue = this.queue.then(() => this.document.save());
        return;
      case 'test:saved':
        this.requests.get(message.id)?.(message.text);
        this.requests.delete(message.id);
        return;
    }
  }

  /**
   * Grava a imagem em `<docs>/assets/` (spec 01, W9) e devolve o link relativo à página. Nunca `blob:`:
   * o endereço temporário do navegador não existe no repositório.
   */
  private async uploadImage(name: string, mime: string, data: Uint8Array): Promise<string> {
    const maxMB = vscode.workspace
      .getConfiguration('techdocsEditor', this.document.uri)
      .get<number>('images.maxSizeMB', DEFAULT_MAX_IMAGE_MB);
    const problem = imageProblem(mime, data.byteLength, maxMB);
    if (problem === 'notAnImage') throw new Error(vscode.l10n.t('"{0}" is not an image', name));
    if (problem === 'tooLarge') {
      throw new Error(vscode.l10n.t('"{0}" is larger than {1} MB. Use a smaller image.', name, maxMB));
    }
    const uri = this.document.uri;
    const remote = uri.scheme === REMOTE_SCHEME ? parseRemoteUri(uri.authority, uri.path) : undefined;
    try {
      if (remote) {
        // Do GitHub: commit no rascunho da página, com o caminho relativo ao repositório (M6)
        const { path, link } = imageTarget(remote.path, this.remoteFs?.session(uri)?.docsDir, name, Date.now());
        await this.remoteFs!.saveImage(uri, path, data);
        return link;
      }
      const { path, link } = imageTarget(uri.path, this.sites.siteOf(uri)?.docsDir, name, Date.now());
      await vscode.workspace.fs.writeFile(uri.with({ path }), data);
      return link;
    } catch (e) {
      throw new Error(vscode.l10n.t('Could not save the image "{0}": {1}', name, e instanceof Error ? e.message : String(e)));
    }
  }

  /**
   * "Ver linha" (spec 01, W12): o texto Markdown na linha, no editor de texto já aberto ao lado ou num
   * novo, ao lado do visual.
   */
  private async showLine(line: number) {
    const position = new vscode.Position(Math.max(0, Math.min(line, this.document.lineCount) - 1), 0);
    const open = vscode.window.visibleTextEditors.find(e => e.document === this.document);
    const editor = await vscode.window.showTextDocument(this.document, {
      viewColumn: open?.viewColumn ?? vscode.ViewColumn.Beside,
      selection: new vscode.Range(position, position),
    });
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /** Conteúdo do documento para o webview: o editor, ou o aviso se o arquivo tem marcadores de conflito. */
  private sendContent() {
    const text = toLf(this.document.getText());
    this.conflicted = hasConflictMarkers(text);
    if (this.conflicted) {
      this.post({
        type: 'conflict',
        message: vscode.l10n.t(
          'This page has Git conflict markers. Resolve the conflict in the Markdown text before editing it here.',
        ),
        action: vscode.l10n.t('Open as text'),
      });
      return;
    }
    this.post({
      type: 'init',
      text,
      language: vscode.env.language,
      baseUri: this.panel.webview.asWebviewUri(this.pageDir).toString(),
      labels: webviewLabels(),
      // Do GitHub: só leitura sem login ou sem permissão de escrita (salvar grava o rascunho, 4c)
      readOnly: this.document.uri.scheme === REMOTE_SCHEME && !this.remoteFs?.canSave(this.document.uri),
    });
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

function webviewLabels(): WebviewLabels {
  return {
    problemsOne: vscode.l10n.t('1 formatting problem'),
    problemsOther: vscode.l10n.t('{0} formatting problems'),
    fixAll: vscode.l10n.t('Fix automatically'),
    line: vscode.l10n.t('Line {0}'),
    showLine: vscode.l10n.t('Show line {0} in the Markdown text'),
    more: vscode.l10n.t('More actions'),
  };
}

function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', name));
  const nonce = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), b =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  // Estilos inline: o ProseMirror e o Crepe posicionam menus com `style`. Imagens externas (https) são
  // as que a própria página já usa; scripts só os do pacote, com nonce. Os pedaços que o módulo principal
  // importa (linguagens dos blocos de código) herdam o nonce dele.
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
  <script type="module" nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}
