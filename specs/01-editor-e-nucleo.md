# 01 — Núcleo compartilhado, editor no webview e fidelidade do Markdown

## Objetivo

O editor visual da extensão é **o mesmo** do plugin: mesma ponte MkDocs, mesmo `tidy`, mesmo lint,
mesmas correções do Milkdown. Toda lição aprendida no plugin vale aqui sem ser reescrita.

## Pacotes

Os dois pacotes nascem **neste repositório** (workspaces, privados até a fase 7), copiados do plugin
na versão 0.2.1 / `-common` 0.2.0. O plugin não muda agora.

| Pacote | Conteúdo | Vem de |
|--------|----------|--------|
| `packages/core` (`@edtroleis/techdocs-editor-core`) | Sem React e sem Backstage: `mkdocs.ts` (ponte e `tidy`), `lint.ts`, `merge3.ts`, `checks.ts`, `github.ts`, `repoConfig.ts`, `setup.ts`, `pageDates.ts`, markdownlint em `vendor/` | `plugins/techdocs-editor-common/src` (sem `permissions.ts` e `session.ts`, que dependem do catálogo) |
| `packages/ui` (`@edtroleis/techdocs-editor-ui`) | React + Milkdown/Crepe: `MarkdownEditor`, `topBar.ts`, `listCaretFix.ts`, `inlineCodeTyping.ts`, `defaultCodeLanguage.ts`, `visualSearch.ts`, `labels.ts`, CSS do Crepe empacotado | `plugins/techdocs-editor/src` (sem as páginas, o painel e os hooks do Backstage) |
| `packages/extension` | A extensão: host (Node e web) e o webview que monta o `ui` | Novo |

Toda correção feita aqui em código que veio do plugin é registrada em `specs/para-o-plugin.md`
(o quê, por quê, teste), para levar ao plugin na fase 7.

Regras:

- **N1** O `core` só depende de `fetch` e de APIs presentes no navegador e no Node 22+; nada de
  `window`, `localStorage` ou `@backstage/*`. O transporte do GitHub continua injetado
  (`GitHubTransport`), com o token lido a cada chamada (lição do "Bad credentials").
- **N2** Os textos do `ui` entram por parâmetro (um objeto de rótulos), em inglês por padrão; o
  plugin preenche com o `translationRef` do Backstage e a extensão com `vscode.l10n`.
- **N3** O `ui` não decide onde gravar imagens nem como ler arquivos: recebe `onUpload(file)` e
  `resolveImage(path)` (lições L4 e L6 do plugin).
- **N4** O CSS do Crepe vai **dentro** do pacote e é importado explicitamente; `sideEffects` lista os
  arquivos CSS gerados. Já quebrou duas vezes no plugin (L1 e 0.2.1).
- **N5** O markdownlint vai empacotado no `core` (cópia em `vendor/`, gerada da versão exata),
  como no `-common`: o `require` dinâmico dele quebra bundlers.

## Editor no webview

| # | Requisito | Origem |
|---|-----------|--------|
| W1 | `CustomTextEditorProvider` (`techdocsEditor.visual`) para `*.md`; o webview recebe o texto do `TextDocument` e devolve edições como `WorkspaceEdit` | X4 |
| W2 | Abrir não gera edição: a normalização feita ao carregar não vira alteração, e voltar ao texto original deixa o documento sem alteração | L3, L7 |
| W3 | Alteração vinda de fora (editor de texto lado a lado, `git checkout`, outra pessoa no modo remoto) atualiza o webview sem perder a posição do cursor quando possível | — |
| W4 | Desfazer/refazer: o do VS Code (sobre o `TextDocument`), com os atalhos repassados pelo webview; o histórico do ProseMirror não pode competir com ele | X4 |
| W5 | Barra fixa com botões que **alternam** (listas, citação, tabela, código, linha horizontal), com `title` e `aria-label` | L11 |
| W6 | Menu `/`, toolbar de seleção, links, tabelas; LaTeX e IA desligados | Spec 05 da demo |
| W7 | Correção do cursor ao criar item de lista (`listCaretFix`) ativa, com teste determinístico | 0.2.0 |
| W8 | "Digitar como código" para código no texto | L10 |
| W9 | Imagens: o clique em "escolher imagem" chega ao campo de arquivo; nunca salva `blob:`; só `image/*` até `images.maxSizeMB` | L4, L6, L15 |
| W10 | Busca no modo visual (Ctrl+F) com "N de M"; no texto, a busca nativa | F23 |
| W11 | Números de linha do arquivo ao lado de cada bloco e marca nos blocos com problema | F22 |
| W12 | "Ver linha": abre o editor de texto nativo na linha, lado a lado | F15, X5 |
| W13 | Tema: segue o tema do VS Code (variáveis `--vscode-*`), claro e escuro | — |
| W14 | Avisos benignos do navegador (`ResizeObserver loop…`) não aparecem como erro | L2 |

## Fidelidade do Markdown

O maior risco técnico continua sendo a ida e volta. Requisitos:

| # | Requisito | Origem |
|---|-----------|--------|
| M1 | Sintaxe do MkDocs desconhecida vira bloco cru editável, nunca HTML: admonitions `!!!`, `???`/`???+`, abas `===` | E1 |
| M2 | Bloco com crases dentro ganha cerca maior que o conteúdo | Spec 05 da demo |
| M3 | `tidy` ao salvar, fora dos blocos de código: marcador `-` e `1.` com renumeração, `---`, linguagem `text` em bloco sem linguagem, sem espaços no fim da linha, sem linhas em branco repetidas, sem `<br />` de Enter vazio | L5, L8, L9, L13, L14 |
| M4 | **Grid cards e blocos HTML com `markdown`** protegidos como bloco cru | Pendência do plugin (quebram hoje) |
| M5 | Listas aninhadas com `-   ` não mudam de estrutura | Pendência do plugin |
| M6 | Alt de verdade nas imagens (o Crepe grava a proporção) | E6 |
| M7 | `roundtrip-check` contra as docs reais (wiki da demo e as 136 páginas do PoC) **antes de cada release**; meta: nenhuma diferença além das cosméticas aceitas (tabelas realinhadas, `<url>`, indentação de continuação) | E2 |

M4 a M6 são do `core`/`ui` e corrigem o plugin junto.

## Lint

| # | Requisito | Origem |
|---|-----------|--------|
| L-1 | Mesma versão do markdownlint e mesmo `.markdownlint.{jsonc,json,yaml,yml}` da raiz do repositório que a pipeline usa, sobre o texto **como vai ser salvo** | Spec 05 da demo |
| L-2 | Ao vivo, 400 ms depois de parar de digitar | Idem |
| L-3 | Problemas como **diagnostics** do VS Code (painel Problemas, sublinhado no editor de texto) e na lateral do editor visual, em linguagem simples, com o trecho | F15 |
| L-4 | Separar o que tem correção automática do que precisa de decisão; "Ajustar agora" como *code action* e botão no visual | L12 |
| L-5 | Correções do editor além das do markdownlint: Título 1 a mais vira 2 (MD025), título que pula nível vai ao esperado (MD001) | L12 |
| L-6 | Convivência com a extensão `DavidAnson.vscode-markdownlint`: se ela estiver instalada, a extensão não duplica os diagnostics nos arquivos de texto (só os mostra no visual) | — |

## Testes desta spec

- Herdar as suítes do plugin que exercitam o editor (`e2e/tests`: barra, menu `/`, atalhos,
  fidelidade, cenários de edição, cursor de lista, segurança) rodando contra o `ui` extraído.
- Cada componente oferecido é **inserido e removido**, e o arquivo volta ao original byte a byte,
  nas páginas reais da wiki.
- No VS Code: abrir, editar, desfazer com Ctrl+Z, salvar e reabrir com o texto nativo, conferindo o
  conteúdo do `TextDocument` (spec 03).
