# Mudanças a levar ao plugin

Código copiado do plugin ([backstage-plugin-techdocs-editor](https://github.com/edtroleis/backstage-plugin-techdocs-editor),
`plugin-techdocs-editor` 0.2.1, `-common` 0.2.0, commit `efd3784`) e mudado aqui. Na fase 7, o plugin passa a
usar os pacotes `core` e `ui` e estas mudanças chegam lá sozinhas; até lá, ficam registradas aqui.

| Data | Arquivo | Mudança | Motivo | Teste |
|------|---------|---------|--------|-------|
| 2026-10-27 | `ui/src/MarkdownEditor.tsx` | Sem `makeStyles` do Material UI: classes `docs-editor`, `docs-editor-line`, `docs-editor-problem` em `editor.css`, cores por variáveis CSS (`--docs-editor-secondary-text`, `--docs-editor-error`) | O `ui` não depende do Backstage | — (visual) |
| 2026-10-27 | `ui/src/MarkdownEditor.tsx` | Prop `onReady` e, no handle, `getMarkdown()` e `insertMarkdown()` | O host precisa saber quando o editor carregou; os testes de integração leem e inserem texto | `test/vscode/suite/tests.ts` |
| 2026-10-27 | `ui/src/messages/{en,pt-BR}.ts` | Textos `editorText.*` tirados da tradução do plugin | O `ui` não usa o `translationRef` do Backstage | `list-caret.spec.ts` (pt-BR e en) |
| 2026-10-27 | `ui/src/MarkdownEditor.tsx` | O aviso de mudança lê `crepe.getMarkdown()` em vez do Markdown que o listener `markdownUpdated` entrega | O `setMarkdown` (linha abaixo) gera transações que o listener ignora e o aviso trazia um documento sem elas. Não afeta o plugin hoje: ver B1 | `test/webview/update.spec.ts`, `e2e/history.spec.ts` |
| 2026-10-27 | `ui/src/MarkdownEditor.tsx` | `onChange(markdown, previous)`; no handle, `setMarkdown`, `pendingChange`, `flushChange`; prop `history` | Mudança de fora entra no editor sem recriá-lo (cursor, rolagem e histórico ficam); a extensão manda só o que mudou | `test/webview/update.spec.ts` |
| 2026-10-27 | `ui/src/externalContent.ts` (novo) | `setMarkdown` troca só o trecho diferente; compara sem o `id` dos títulos e com o parágrafo vazio final; diferença que pega estrutura (tabela, lista) troca os blocos de primeiro nível inteiros | Sem isso, a diferença ia do primeiro título ao fim (cursor ia para o fim) e tabela consertada pelo plugin de tabelas não voltava ao desfazer | `ui/src/externalContent.test.ts`, `e2e/history.spec.ts` |
| 2026-10-27 | `ui/src/externalHistory.ts` (novo), `ui/src/topBar.ts` | Desfazer/refazer da barra e Ctrl+Z/Y/Shift+Z vão para um histórico de fora quando ele existe | Na extensão o histórico é um só, o do documento do VS Code (spec 01, W4). No plugin, sem `history`, nada muda | `e2e/history.spec.ts` |
| 2026-10-27 | `core/src/lintRules.ts` (novo) | Textos das regras do markdownlint em linguagem simples (en e pt-BR), os mesmos de `lintRules` do plugin | A extensão mostra os problemas no painel Problemas (host, sem React); no plugin, podem substituir as chaves `lintRules.*` da tradução | `extension/src/lintProblems.test.ts` |
| 2026-10-27 | `ui/src/SearchBar.tsx` (novo), `ui/src/visualSearch.ts`, `ui/src/MarkdownEditor.tsx`, `ui/src/editor.css` | `SearchBar` e `useVisualSearch` do plugin sem Material UI (HTML com classes `docs-search-*`, textos `search.*` em `messages`); `show(texto)` já procura pelo texto selecionado; `refresh()` e, no handle, `searchResult()` e `focus()`; Esc devolve o foco ao texto; cores dos destaques por variáveis CSS (`--docs-search-match`, `--docs-search-current`) | O `ui` não depende do Backstage; no plugin o total ficava velho quando o texto mudava com a barra aberta, e o foco ficava perdido depois de fechar | `test/webview/search.spec.ts`, `e2e/search.spec.ts` |
| 2026-10-27 | `ui/src/imageAlt.ts` (novo), `ui/src/MarkdownEditor.tsx` | O bloco de imagem guarda o texto alternativo (`alt`) e não grava mais o tamanho na tela no lugar dele; sem `alt`, usa a legenda; imagem recém-enviada sem legenda usa o nome do arquivo, como o GitHub | Ver B3: o texto alternativo de toda imagem sozinha no parágrafo virava `1.00` | `test/webview/images.spec.ts`, `test/fixtures/wiki/docs/guias/imagens.md` (ida e volta) |
| 2026-10-27 | `ui/src/MarkdownEditor.tsx`, `ui/src/editor.css` | Props `onLineClick` (número da linha clicável, com teclado) e `lineTitle` (dica com o problema da linha) | "Ver linha" (W12) e o problema na dica. Ver B2: no plugin a dica `problemMark` nunca aparece | `test/webview/problems.spec.ts` |

## Bugs encontrados aqui: situação no plugin

O que deu errado na extensão e pode valer para o plugin. Cada bug foi testado no plugin publicado, sem alterar
nada nele: harness do plugin (`plugins/techdocs-editor/e2e/harness`) com testes à parte.

### B1. Aviso de mudança com o Markdown desatualizado

| | |
|---|---|
| Sintoma (na extensão) | Depois de digitar e logo receber uma mudança de fora, o editor repassava um texto velho. Apareciam edições fantasma, e o desfazer parecia pular passos |
| Causa | O listener `markdownUpdated` do Milkdown (`@milkdown/plugin-listener`) ignora transações com `addToHistory: false` e, 200 ms depois da última mudança aceita, serializa o documento **daquela** transação. Uma mudança marcada com `addToHistory: false` dentro dessa janela fica de fora do Markdown entregue. Na extensão, a origem era o nosso `setMarkdown` |
| Correção aqui | O aviso lê `crepe.getMarkdown()` (o documento de agora) em vez do Markdown que o listener entrega |
| Situação no plugin (0.2.1, `efd3784`) | **Não reproduzido, latente.** As únicas transações com `addToHistory: false` no plugin vêm do Milkdown (`sync-heading-id` e `sync-list-order`) e não mudam o Markdown salvo. Testado em 2026-10-27, nos cinco cenários abaixo o que o plugin salvaria bateu com o documento do editor |
| Quando passa a valer no plugin | Se ele passar a mudar o documento com `addToHistory: false`: atualizar o conteúdo sem recriar o editor (o `setMarkdown` da fase 7), aplicar correções do lint no lugar, trocar o endereço de imagem depois do envio. A fase 7 já leva a correção junto |

Cenários testados no plugin (o salvo comparado com o documento do ProseMirror):

1. Item novo no meio de lista numerada: rótulos renumerados, salvo `1. um / 2. novo / 3. dois / 4. tres`.
2. Item apagado no meio de lista numerada: salvo `1. um / 2. tres`.
3. Digitação em rajadas (cinco palavras com pausas menores que 200 ms): salvo com as cinco.
4. `1. ` digitado num item novo de lista com marcadores: continua item com marcador, salvo `- 1\. tres`.
5. `1. ` digitado no começo de um item com marcadores: salvo `- 1\. um`.

Teste para levar ao plugin se ele ganhar `setMarkdown`: digitar, chamar `setMarkdown` com uma mudança em outro
parágrafo antes de 200 ms e conferir que o salvo tem as duas (aqui: `test/webview/update.spec.ts`).

### B2. Dica da marca de problema nunca aparece

| | |
|---|---|
| Sintoma | Passar o mouse no `● 12` ao lado de um bloco com problema não mostra a dica "Há um problema neste trecho" |
| Causa | O número da linha tem `pointer-events: none` (para não atrapalhar o clique no texto) e o `title` com a dica; elemento que não recebe o mouse não mostra dica |
| Correção aqui | Com `onLineClick`, o número recebe o mouse (`.docs-editor-line-link`: `pointer-events: auto`) e a dica traz o problema em si (`lineTitle`) |
| Situação no plugin (0.2.1, `efd3784`) | **Confirmado no código**, não rodando: `MarkdownEditor.tsx` linha 38 (`pointerEvents: 'none'`) e linha 235 (`title={mark.problem ? text.problemMark : undefined}`) |
| Correção sugerida | Só as marcas com problema recebem o mouse (`pointer-events: auto` em `.docs-editor-problem`); a fase 7 leva a versão daqui |

### B3. Texto alternativo das imagens vira `1.00`

| | |
|---|---|
| Sintoma | `![Diagrama da arquitetura](../assets/a.png)` sozinho no parágrafo é gravado como `![1.00](../assets/a.png)`. A descrição da imagem (leitores de tela, imagem que não carrega) se perde, e o lint não acusa, porque `1.00` conta como texto alternativo. Imagem nova enviada pelo editor também sai com `![1.00](…)` |
| Causa | O bloco de imagem do Crepe (`@milkdown/components/image-block`, 7.22.3) usa o `alt` do Markdown para guardar o tamanho do bloco na tela: lê `Number(alt)` (texto vira 1) e grava `ratio.toFixed(2)`. A legenda vai no título da imagem |
| Correção aqui | `ui/src/imageAlt.ts` troca a leitura e a gravação do bloco: o `alt` fica como estava; sem ele, a legenda; imagem enviada sem legenda, o nome do arquivo. O tamanho na tela não vai mais para o arquivo (o MkDocs não usa) |
| Situação no plugin (0.2.1, `efd3784`) | **Confirmado no código**, não rodando: mesmo Crepe (7.22.3), sem nada que troque o bloco de imagem, e o plugin grava o Markdown inteiro (`usePublishFlow.tsx` linha 173, `fromEditor(markdown)`). Então todo salvamento troca o texto alternativo de todas as imagens sozinhas no parágrafo da página. Aqui o efeito era menor: a extensão só aplica o trecho alterado, e a imagem só perdia o texto quando o bloco dela mudava. Reproduzido aqui com o mesmo Crepe, antes da correção: `![Diagrama da arquitetura](assets/a.png)` saiu `![1.00](assets/a.png)` |
| Correção sugerida | A fase 7 leva `imageAlt.ts`. Teste para levar: página com imagens com texto alternativo na ida e volta (aqui, `guias/imagens.md` das wikis de teste). O teste do plugin `fromEditor('Um.\n\n![1.00]()\n')` continua valendo para arquivos já gravados com `1.00` |

### Só da extensão (não se aplicam ao plugin hoje)

- **Cursor no fim do documento e tabela que não voltava ao desfazer** (`externalContent.ts`): só existe com o
  `setMarkdown`; o plugin recria o editor quando o conteúdo muda.
- **Desfazer pela barra perdido com o foco no texto ao lado** (painel ainda não ativo no host): do VS Code.
