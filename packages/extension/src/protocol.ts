/** Mensagens entre o host da extensão e o webview do editor visual. */

export type HostMessage =
  /** Conteúdo do arquivo ao abrir (formato do repositório, com `\n`). */
  | { type: 'init'; text: string; language: string; baseUri: string }
  /** O documento mudou fora do editor visual (editor de texto, desfazer do VS Code, git). */
  | { type: 'update'; text: string }
  /** Testes: devolve o que o editor gravaria agora (`fromEditor` do Markdown do editor). */
  | { type: 'test:getSaved'; id: number }
  /** Testes: insere Markdown no cursor, como se a pessoa digitasse. */
  | { type: 'test:insert'; markdown: string };

export type WebviewMessage =
  /** O script do webview está ouvindo: só agora o host manda o `init` (antes, a mensagem se perdia). */
  | { type: 'loaded' }
  | { type: 'ready' }
  /** Texto novo do documento (formato do repositório, com `\n`). */
  | { type: 'edit'; text: string }
  | { type: 'test:saved'; id: number; text: string };
