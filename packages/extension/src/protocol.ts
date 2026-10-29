/** Mensagens entre o host da extensão e o webview do editor visual. */

/** Problema de formatação mostrado no editor visual (spec 01, L-3). */
export type ProblemView = { line: number; message: string; fixable: boolean };

/** Textos da extensão no webview, já na língua do VS Code (`{0}`: número). */
export type WebviewLabels = {
  problemsOne: string;
  problemsOther: string;
  fixAll: string;
  line: string;
  showLine: string;
};

export type HostMessage =
  /** Conteúdo do arquivo ao abrir (formato do repositório, com `\n`). */
  | { type: 'init'; text: string; language: string; baseUri: string; labels: WebviewLabels; readOnly?: boolean }
  /** O documento mudou fora do editor visual (editor de texto, desfazer do VS Code, git). */
  | { type: 'update'; text: string }
  /**
   * O arquivo tem marcadores de conflito do Git: no lugar do editor, o aviso com o botão (spec 02, LC4).
   * Resolvido o conflito, o host manda `init` de novo e o editor volta.
   */
  | { type: 'conflict'; message: string; action: string }
  /** Seleciona o trecho no editor visual (página nova de template: o primeiro trecho a preencher, TP7). */
  | { type: 'select'; text: string }
  /** Problemas de formatação da página, a cada lint (lista vazia: sem problemas). */
  | { type: 'lint'; problems: ProblemView[] }
  /** Resposta a `uploadImage`: o link para pôr no Markdown, ou o motivo da recusa (já mostrado ao usuário). */
  | { type: 'uploaded'; id: number; link?: string; error?: string }
  /** Testes: devolve o que o editor gravaria agora (`fromEditor` do Markdown do editor). */
  | { type: 'test:getSaved'; id: number }
  /** Testes: insere Markdown no cursor, como se a pessoa digitasse. */
  | { type: 'test:insert'; markdown: string }
  /** Testes: clica no botão da barra fixa do editor (posição, a partir de 0). */
  | { type: 'test:clickTopBar'; index: number }
  /** Testes: clica no elemento do webview (o primeiro que casar com o seletor). */
  | { type: 'test:click'; selector: string }
  /** Testes: escolhe o arquivo no botão de envio do primeiro bloco de imagem vazio, como a pessoa faria. */
  | { type: 'test:chooseImage'; name: string; mime: string; data: Uint8Array };

export type WebviewMessage =
  /** O script do webview está ouvindo: só agora o host manda o `init` (antes, a mensagem se perdia). */
  | { type: 'loaded' }
  /** Editor (ou o aviso de conflito) na tela. */
  | { type: 'ready' }
  /** "Abrir como texto" no aviso de conflito. */
  | { type: 'openText' }
  /** "Ajustar agora": aplicar as correções automáticas do lint ao documento. */
  | { type: 'fixLint' }
  /** "Ver linha": abrir o texto Markdown ao lado, nesta linha do arquivo (spec 01, W12). */
  | { type: 'showLine'; line: number }
  /** Imagem escolhida no editor visual: o host grava em `<docs>/assets/` e responde com `uploaded`. */
  | { type: 'uploadImage'; id: number; name: string; mime: string; data: Uint8Array }
  /**
   * Mudança feita pela pessoa no editor visual: o texto antes e depois dela (formato do repositório,
   * com `\n`). O host aplica só essa diferença ao documento como ele está (ver rebase.ts).
   */
  | { type: 'edit'; before: string; after: string }
  /** Desfazer ou refazer no documento (o histórico é um só: o do VS Code). */
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'test:saved'; id: number; text: string };
