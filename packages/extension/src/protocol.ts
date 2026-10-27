/** Mensagens entre o host da extensão e o webview do editor visual. */

export type HostMessage =
  /** Conteúdo do arquivo ao abrir (formato do repositório, com `\n`). */
  | { type: 'init'; text: string; language: string; baseUri: string }
  /** O documento mudou fora do editor visual (editor de texto, desfazer do VS Code, git). */
  | { type: 'update'; text: string }
  /**
   * O arquivo tem marcadores de conflito do Git: no lugar do editor, o aviso com o botão (spec 02, LC4).
   * Resolvido o conflito, o host manda `init` de novo e o editor volta.
   */
  | { type: 'conflict'; message: string; action: string }
  /** Testes: devolve o que o editor gravaria agora (`fromEditor` do Markdown do editor). */
  | { type: 'test:getSaved'; id: number }
  /** Testes: insere Markdown no cursor, como se a pessoa digitasse. */
  | { type: 'test:insert'; markdown: string }
  /** Testes: clica no botão da barra fixa do editor (posição, a partir de 0). */
  | { type: 'test:clickTopBar'; index: number };

export type WebviewMessage =
  /** O script do webview está ouvindo: só agora o host manda o `init` (antes, a mensagem se perdia). */
  | { type: 'loaded' }
  /** Editor (ou o aviso de conflito) na tela. */
  | { type: 'ready' }
  /** "Abrir como texto" no aviso de conflito. */
  | { type: 'openText' }
  /**
   * Mudança feita pela pessoa no editor visual: o texto antes e depois dela (formato do repositório,
   * com `\n`). O host aplica só essa diferença ao documento como ele está (ver rebase.ts).
   */
  | { type: 'edit'; before: string; after: string }
  /** Desfazer ou refazer no documento (o histórico é um só: o do VS Code). */
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'test:saved'; id: number; text: string };
