# Mermaid: clique duplo leva ao código, cinco modelos e o ELK de volta — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na 0.11.0, clique duplo num texto do diagrama abre o código no trecho certo, o menu `/` oferece cinco modelos e o layout ELK volta ao pacote.

**Architecture:** O bloco de código do Crepe fica como está (forma A do spec). Um módulo puro (`diagramSource.ts`) acha o trecho do código a partir do que foi clicado; um plugin ProseMirror (`diagramDoubleClick.ts`) escuta o `dblclick` no `view.dom`, aperta o botão "Editar" do Crepe e põe uma seleção do ProseMirror no trecho, que o `setSelection` do node view passa ao CodeMirror. Os modelos são textos em `messages/` e itens novos no `slashMenu`.

**Tech Stack:** TypeScript, Milkdown/Crepe 7.22 (`@milkdown/kit`, `@milkdown/components` code-block), Mermaid 12.2, Vitest, Playwright (`test:editor`, `test:webview`), esbuild (`packages/extension/build.mjs`).

**Spec:** `specs/06-mermaid.md` (itens M9, M10, M11 e a seção "M10 e M11: decisões (2026-11-20)").

## Global Constraints

- Commits só em nome do usuário, sem `Co-Authored-By`; mensagens no padrão do repositório (`feat(editor): …`, `docs(specs): …`), em pt-BR.
- Textos da extensão em pt-BR e inglês (`packages/ui/src/messages/pt-BR.ts` e `en.ts`); em pt-BR, "diretório", nunca "pasta".
- Rodar só os testes da mudança (`npx vitest run <arquivo>`, `npm run test:editor -- <arquivo> -g "<nome>"`); a suíte completa (`test:all`) só na publicação. Todo comando de teste com limite de tempo duro (`timeout 600 …`); se parar de avançar, matar e investigar.
- O hook de edição roda `test:fast` em paralelo: esperar ele acabar antes de `test:webview`/`test:vscode`.
- Nada muda no Markdown salvo: abrir, clicar duas vezes e sair sem digitar não altera o arquivo.
- Clique simples continua selecionando o bloco; no modo leitura o clique duplo não faz nada e a dica não aparece.
- Dica: pt-BR "Clique duas vezes num texto do desenho para editá-lo"; en "Double-click a text in the drawing to edit it".

## Review Focus

- Dois nós com o mesmo rótulo ("Sim" em `B` e em `D`): o clique duplo no segundo vai à linha do `D`, não à primeira com "Sim" (Task 2, pelo id).
- Diagrama com front matter (`---\nconfig:\n  layout: elk\n---\nflowchart LR …`): a linha do tipo é a depois do front matter e os trechos não caem dentro dele (Task 2).
- Código mudado logo antes do clique duplo (desenho ainda antigo): o trecho é calculado sobre o texto atual do nó no documento, nunca sobre o código do desenho em cache; se não achar, cursor no início (Task 3).
- Digitar por cima do trecho e desfazer (`Ctrl+Z`): volta ao texto original, e o arquivo salvo fica igual ao de antes (Task 3).
- Página em modo leitura (modo remoto só para ler): clique duplo não abre o código nem muda nada (Task 3).

---

### Task 1: O ELK volta ao pacote (M9)

**Files:**
- Modify: `packages/extension/build.mjs:27-57` (sai o `withoutElk` e as constantes `ELK_LOADERS`/`ELK_IMPORT`) e `:111` (`plugins: [withoutKatex]`)
- Modify: `packages/extension/test/webview/mermaid.spec.ts:24-28`
- Modify: `specs/06-mermaid.md` (linha do M9)

**Interfaces:** nenhuma.

- [ ] **Step 1: Mudar o teste do webview para provar que o ELK desenha**

Renomear o teste para `'diagrama que pede o layout ELK é desenhado com o ELK'` e, além do SVG visível e sem `.mermaid-error`, conferir que o pedaço do ELK foi carregado: `expect(await page.evaluate(() => performance.getEntriesByType('resource').some(r => /elk/i.test(r.name)))).toBe(true)`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 600 npm run test:webview -- mermaid.spec.ts -g "ELK"`
Expected: FAIL na asserção do recurso `elk`.

- [ ] **Step 3: Tirar o plugin `withoutElk` do `build.mjs`**

No lugar do bloco, um comentário de duas linhas: o ELK vai no pacote num pedaço carregado só quando um diagrama pede `layout: elk`; o site do TechDocs carrega o Mermaid sem o ELK e desenha esses diagramas com o dagre.

- [ ] **Step 4: Rodar o teste e o orçamento**

Run: `timeout 600 npm run test:webview -- mermaid.spec.ts -g "ELK"` → PASS.
Run: `timeout 600 npm run test:bundle` → PASS, abertura ainda ~459 KB gzip (o ELK é um pedaço à parte).
Run: `cd packages/extension && timeout 300 npx vsce package --no-dependencies -o /tmp/claude-1000/-home-edtroleis-code-vscode-techdocs-editor/3c69ca0b-7850-4a88-8eca-5bd07b306396/scratchpad/elk.vsix && ls -la /tmp/claude-1000/-home-edtroleis-code-vscode-techdocs-editor/3c69ca0b-7850-4a88-8eca-5bd07b306396/scratchpad/elk.vsix` → ~3,2 MB.

- [ ] **Step 5: Corrigir o M9 no spec**

O orçamento do `test:bundle` não muda (mede só a abertura); trocar "e o orçamento do `test:bundle` sobe" por "o orçamento da abertura (`test:bundle`) não muda; o ELK é um pedaço carregado só quando pedido".

- [ ] **Step 6: Commit**

```bash
git add packages/extension/build.mjs packages/extension/test/webview/mermaid.spec.ts specs/06-mermaid.md
git commit -m "feat(mermaid): layout ELK de volta no pacote (M9)"
```

### Task 2: Mapa do desenho para o código (`diagramSource.ts`, M10)

**Files:**
- Create: `packages/ui/src/diagramSource.ts`
- Test: `packages/ui/src/diagramSource.test.ts`

**Interfaces:**
- Produces:
  - `export type DiagramTarget = { nodeId?: string; text: string }`: o que foi clicado; `nodeId` só no fluxograma.
  - `export type CodeRange = { from: number; to: number }`: posições no texto do diagrama (0 = início do código).
  - `export function locateInDiagram(code: string, target: DiagramTarget): CodeRange | undefined`

Regras (o teste fixa cada uma):
1. A linha do tipo é a primeira não vazia depois do front matter (`---` … `---` no início) e que não é comentário (`%%`). Nada antes dela nem ela própria é resultado.
2. Fluxograma (`flowchart` ou `graph` na linha do tipo) com `nodeId`: a primeira linha em que o id aparece como palavra inteira seguido de uma forma (`[`, `(`, `{`, `>`, incluindo `[[`, `((`, `{{`, `[(`, `([`, `[/`, `[\`) seleciona o rótulo dentro da forma, sem os espaços e as aspas das pontas; se o id não tem forma em nenhuma linha, seleciona a primeira ocorrência do id como palavra inteira.
3. Sem `nodeId`, ou nenhum resultado pela regra 2: a primeira linha (depois da do tipo) que contém `text` (espaços seguidos tratados como um só, sem diferenciar maiúsculas) seleciona esse trecho.
4. `text` vazio e nada pela regra 2: `undefined`.

- [ ] **Step 1: Escrever os testes**

```ts
import { locateInDiagram } from './diagramSource';

const pick = (code: string, target: Parameters<typeof locateInDiagram>[1]) => {
  const r = locateInDiagram(code, target);
  return r && code.slice(r.from, r.to);
};
const flow = 'flowchart LR\n  A[Pedido criado] --> B{Pagamento aprovado?}\n  B -- Sim --> C[Separar]\n  B -- Não --> D[Avisar]\n  C --> E';

describe('locateInDiagram', () => {
  it('nó com rótulo: seleciona o rótulo pela id', () => expect(pick(flow, { nodeId: 'B', text: 'Pagamento aprovado?' })).toBe('Pagamento aprovado?'));
  it('nó sem forma: seleciona a id', () => expect(pick(flow, { nodeId: 'E', text: 'E' })).toBe('E'));
  it('formas ( ) [[ ]] (( )) e aspas', () => {
    const code = 'flowchart TD\n  X("Início") --> Y[[Sub]]\n  Y --> Z((Fim))';
    expect(pick(code, { nodeId: 'X', text: 'Início' })).toBe('Início');
    expect(pick(code, { nodeId: 'Y', text: 'Sub' })).toBe('Sub');
    expect(pick(code, { nodeId: 'Z', text: 'Fim' })).toBe('Fim');
  });
  it('mesmo rótulo em dois nós: vai pela id', () => {
    const code = 'flowchart LR\n  B[Sim] --> D[Sim]';
    const r = locateInDiagram(code, { nodeId: 'D', text: 'Sim' })!;
    expect(r.from).toBe(code.lastIndexOf('Sim'));
  });
  it('id que é parte de outra (A e AB): só a palavra inteira', () => expect(pick('flowchart LR\n  AB[Outro] --> A[Este]', { nodeId: 'A', text: 'Este' })).toBe('Este'));
  it('rótulo de seta: pelo texto', () => expect(pick(flow, { text: 'Não' })).toBe('Não'));
  it('rótulo com espaços diferentes do desenho', () => expect(pick('flowchart LR\n  A[Dois   espaços]', { nodeId: 'A', text: 'Dois espaços' })).toBe('Dois   espaços'));
  it('front matter fica de fora', () => {
    const code = '---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A[elk] --> B';
    expect(locateInDiagram(code, { nodeId: 'A', text: 'elk' })!.from).toBe(code.indexOf('A[elk]') + 2);
  });
  it('sequência, estados, Gantt, entidades: pelo texto', () => {
    expect(pick('sequenceDiagram\n  Loja->>Banco: Cobrar pedido', { text: 'Cobrar pedido' })).toBe('Cobrar pedido');
    expect(pick('stateDiagram-v2\n  Criado --> Pago: aprovado', { text: 'Pago' })).toBe('Pago');
    expect(pick('gantt\n  title Migração\n  Cópia de teste :a1, 2026-11-09, 3d', { text: 'Cópia de teste' })).toBe('Cópia de teste');
    expect(pick('erDiagram\n  CLIENTE ||--o{ PEDIDO : faz', { text: 'PEDIDO' })).toBe('PEDIDO');
  });
  it('a linha do tipo não é resultado', () => expect(pick('sequenceDiagram\n  A->>B: sequenceDiagram', { text: 'sequenceDiagram' })).toBe('sequenceDiagram'));
  it('não achou', () => {
    expect(locateInDiagram(flow, { text: '100%' })).toBeUndefined();
    expect(locateInDiagram(flow, { text: '' })).toBeUndefined();
  });
});
```

(No caso "a linha do tipo não é resultado", conferir também `from > 'sequenceDiagram'.length`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 120 npx vitest run packages/ui/src/diagramSource.test.ts`
Expected: FAIL, módulo não existe.

- [ ] **Step 3: Implementar `locateInDiagram` em `packages/ui/src/diagramSource.ts`**

Sem DOM e sem Mermaid (o passo 3 do spec reaproveita). Trabalhar por linhas guardando o deslocamento de cada uma; o id vai para a regex escapado.

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 120 npx vitest run packages/ui/src/diagramSource.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/diagramSource.ts packages/ui/src/diagramSource.test.ts
git commit -m "feat(mermaid): achar no código o trecho clicado no desenho (M10)"
```

### Task 3: Clique duplo abre o código no trecho, com a dica (M10)

**Files:**
- Create: `packages/ui/src/diagramDoubleClick.ts`
- Modify: `packages/ui/src/MarkdownEditor.tsx:224-231` (`.use(diagramDoubleClickPlugin)`)
- Modify: `packages/ui/src/mermaidPreview.ts` (`DiagramText.hint`, dica no `diagramElement`)
- Modify: `packages/ui/src/labels.ts:29,64-70` (`diagram.hint: k('diagramHint')`)
- Modify: `packages/ui/src/messages/pt-BR.ts`, `en.ts` (`'editorText.diagramHint'`)
- Modify: `packages/ui/src/editor.css` (`.mermaid-hint`)
- Modify: `packages/ui/e2e/harness/main.tsx` (parâmetro `readonly=1` passa `readOnly` ao `MarkdownEditor`)
- Test: `packages/ui/e2e/tests/mermaid.spec.ts`

**Interfaces:**
- Consumes: `locateInDiagram`, `DiagramTarget`, `CodeRange` (Task 2).
- Produces: `export const diagramDoubleClickPlugin` (`$prose`); `export function targetFromElement(element: Element): DiagramTarget` (no mesmo arquivo).

Comportamento:
- `targetFromElement`: `text` = `textContent` do rótulo mais próximo (`foreignObject`, `text`, `.nodeLabel`, `.edgeLabel`, `.label`; senão o próprio elemento), espaços juntados e aparado; `nodeId` vem do `g.node` ancestral, com id no formato do Mermaid `…flowchart-<id>-<n>` (regex `/(?:^|-)flowchart-(.+)-\d+$/`). Conferir o formato no SVG real no Step 2 e ajustar a regex se o Mermaid 12.2 usar outro.
- Listener `dblclick` no `view.dom` (o node view do Crepe tem `stopEvent() → true`, então `handleDOMEvents` não recebe): ignora se `!view.editable` ou se o alvo não está num `.mermaid-diagram`; `preventDefault()` (não selecionar palavra no SVG); acha o `.milkdown-code-block` ancestral e a posição do nó procurando no `doc` o `code_block` com `view.nodeDOM(pos) === bloco`; calcula o trecho sobre `node.textContent` **no momento do clique**; não achou → `{ from: 0, to: 0 }`.
- Se o `.codemirror-host` do bloco tem a classe `hidden`, clica no `.preview-toggle-button`; no `requestAnimationFrame` seguinte, `view.focus()` e `dispatch(tr.setSelection(TextSelection.create(doc, pos + 1 + from, pos + 1 + to)).scrollIntoView())`.
- A dica é um `<p class="mermaid-hint">` com `DiagramText.hint` depois do SVG, dentro do `.mermaid-diagram` (sai também na prévia do modo Editar). CSS: cor `var(--vscode-descriptionForeground)` como as outras notas do editor, fonte menor; `.ProseMirror[contenteditable="false"] .mermaid-hint { display: none }`.

- [ ] **Step 1: Escrever os testes do editor**

Em `mermaid.spec.ts`, com `const flow = page1('flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Fim]')` e `const label = (page, t) => block(page).locator('.mermaid-diagram svg').getByText(t, { exact: true })`:

```ts
test('clique duplo num texto do desenho abre o código com o texto selecionado', async ({ page }) => {
  await openEditor(page, flow);
  await expect(block(page).locator('.mermaid-hint')).toHaveText('Clique duas vezes num texto do desenho para editá-lo');
  await label(page, 'Decisão').dblclick();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await page.keyboard.type('Pago?');
  expect(await saved(page)).toBe(page1('flowchart LR\n  A[Início] --> B{Pago?}\n  B --> C[Fim]'));
});

test('com o código aberto, o clique duplo leva a outra linha; desfazer volta', async ({ page }) => {
  await openEditor(page, flow);
  await label(page, 'Decisão').dblclick();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await label(page, 'Fim').dblclick();
  await page.keyboard.type('Saída');
  expect(await saved(page)).toBe(page1('flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Saída]'));
  await page.keyboard.press('Control+z');
  await expect.poll(() => saved(page)).toBe(flow);
});

test('texto que não está no código: abre o código com o cursor no início', async ({ page }) => {
  await openEditor(page, page1('pie\n  "Cães" : 1'));
  await label(page, '100%').dblclick();
  await page.keyboard.type('%% x\n');
  expect(await saved(page)).toBe(page1('%% x\npie\n  "Cães" : 1'));
});

test('clique simples não abre o código', async ({ page }) => {
  await openEditor(page, flow);
  await label(page, 'Decisão').click();
  await page.waitForTimeout(300);
  await expect(block(page).locator('.codemirror-host')).toHaveClass(/hidden/);
});

test('modo leitura: sem dica e o clique duplo não abre o código', async ({ page }) => {
  await page.goto(`/?readonly=1&md=${encodeURIComponent(flow)}`);
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  await expect(block(page).locator('.mermaid-hint')).toBeHidden();
  await label(page, 'Decisão').dblclick();
  await page.waitForTimeout(300);
  await expect(block(page).locator('.codemirror-host')).toHaveClass(/hidden/);
});
```

O `openEditor` espera a barra; no teste do modo leitura, se a barra não aparece em leitura, usar o `page.goto` direto como acima. Se o Mermaid desenhar o rótulo do pie como "100.00%" ou outro, usar o texto que ele desenha (conferir no Step 2).

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 600 npm run test:editor -- mermaid.spec.ts -g "clique|leitura"`
Expected: FAIL (sem `.mermaid-hint`, código não abre). Abrir o SVG de um fluxograma no teste (`svg.evaluate(e => e.innerHTML)`) e conferir o id dos `g.node`.

- [ ] **Step 3: Implementar a dica (`mermaidPreview.ts`, labels, messages, CSS) e o parâmetro `readonly` do harness**

- [ ] **Step 4: Implementar `diagramDoubleClick.ts` e registrar no `MarkdownEditor.tsx`**

- [ ] **Step 5: Rodar e ver passar**

Run: `timeout 600 npm run test:editor -- mermaid.spec.ts` → PASS (os testes antigos do arquivo também).
Run: `timeout 120 npx vitest run packages/ui/src/mermaidPreview.test.ts packages/ui/src/diagramSource.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/diagramDoubleClick.ts packages/ui/src/MarkdownEditor.tsx packages/ui/src/mermaidPreview.ts packages/ui/src/labels.ts packages/ui/src/messages packages/ui/src/editor.css packages/ui/e2e
git commit -m "feat(mermaid): clique duplo num texto do desenho abre o código no trecho (M10)"
```

### Task 4: Cinco modelos no menu `/` (M11)

**Files:**
- Modify: `packages/ui/src/messages/pt-BR.ts`, `en.ts`
- Modify: `packages/ui/src/labels.ts` (tipo `EditorText.diagram`, `slashMenu`)
- Modify: `packages/ui/src/insertDiagram.ts` (`insertDiagram(ctx, sample?)`)
- Modify: `packages/ui/src/icons.ts` (cinco ícones)
- Modify: `packages/ui/e2e/harness/main.tsx` (parâmetro `lang=en` usa o catálogo `en`)
- Modify: `specs/06-mermaid.md` (linha do M11)
- Test: `packages/ui/e2e/tests/slash-menu.spec.ts`, `packages/ui/e2e/tests/mermaid.spec.ts`

**Interfaces:**
- Consumes: `insertDiagram` atual.
- Produces:
  - `export type DiagramTemplate = { key: 'flow' | 'sequence' | 'state' | 'gantt' | 'entities'; label: string; sample: string; icon: string }`
  - `EditorText.diagram.templates: DiagramTemplate[]` (nessa ordem).
  - `insertDiagram(ctx: Ctx, sample?: string)`: sem `sample`, usa o do `diagramInsertCtx` (a barra continua igual).

Decisões:
- O menu do Crepe não tem descrição por item e só filtra pelo rótulo. Por isso o rótulo leva o tipo: "Diagrama: fluxograma", "Diagrama: sequência", "Diagrama: estados", "Diagrama: cronograma (Gantt)", "Diagrama: entidades" (en: "Diagram: flowchart", "Diagram: sequence", "Diagram: states", "Diagram: timeline (Gantt)", "Diagram: entities"). `/diagrama` filtra os cinco. Sem a frase de cada um.
- Os cinco ficam onde está hoje o item único "Diagrama (Mermaid)", logo depois de "Bloco de código", e o item único sai do `/`. O botão da barra e o rótulo `diagram.label` não mudam.
- Chaves novas: `editorText.diagramFlow`, `diagramSequence`, `diagramState`, `diagramGantt`, `diagramEntities` (rótulos) e `editorText.diagramSampleSequence`, `diagramSampleState`, `diagramSampleGantt`, `diagramSampleEntities`; o fluxograma usa o `editorText.diagramSample` que já existe.
- Exemplos (pt-BR; o en com os mesmos ids e textos traduzidos), curtos como o atual:
  - Sequência: `sequenceDiagram\n  participant Loja\n  participant Banco\n  Loja->>Banco: Pedir autorização\n  Banco-->>Loja: Autorizado`
  - Estados: `stateDiagram-v2\n  [*] --> Criado\n  Criado --> Pago: pagamento aprovado\n  Pago --> Entregue\n  Entregue --> [*]`
  - Gantt: `gantt\n  title Projeto\n  dateFormat YYYY-MM-DD\n  section Preparar\n  Levantar requisitos :a1, 2026-01-05, 3d\n  Revisar :after a1, 2d`
  - Entidades: `erDiagram\n  CLIENTE ||--o{ PEDIDO : faz\n  PEDIDO ||--|{ ITEM : tem`
- Ícones: 24×24 no mesmo `icon(path)` do `DIAGRAM_ICON`; o fluxograma reaproveita o `DIAGRAM_ICON`.

- [ ] **Step 1: Escrever os testes**

Em `slash-menu.spec.ts`, trocar `'Diagrama (Mermaid)'` na lista pelos cinco rótulos, na ordem, e acrescentar o teste `'/diagrama mostra os cinco modelos'` (cinco itens visíveis depois de digitar `/diagrama`).
Em `mermaid.spec.ts`, para cada idioma (`''` e `'&lang=en'`) e cada um dos cinco itens: abrir uma página, `newLineAtEnd`, `slash(page, rótulo)`, esperar o novo bloco com `.mermaid-diagram svg` visível e `.mermaid-error` com contagem 0. Os rótulos e exemplos do inglês vêm de `import en from '../../src/messages/en'`, não copiados.

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 600 npm run test:editor -- slash-menu.spec.ts mermaid.spec.ts -g "modelo|Diagrama|diagrama"`
Expected: FAIL (itens não existem).

- [ ] **Step 3: Implementar mensagens, ícones, `templates`, `insertDiagram(ctx, sample)`, o `slashMenu` e o `lang=en` do harness**

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 600 npm run test:editor -- slash-menu.spec.ts mermaid.spec.ts top-bar.spec.ts` → PASS.
Run: `timeout 600 npm run test:vscode` com `TEST_GREP="M7"` (ou o nome do teste do M7) → PASS: o primeiro diagrama inserido por um dos modelos ainda configura o `mkdocs.yml`.

- [ ] **Step 5: Corrigir o M11 no spec**

Rótulos "Diagrama: …" no lugar da frase (o menu do Crepe não tem descrição e filtra só pelo rótulo); o item único "Diagrama (Mermaid)" sai do `/`.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src packages/ui/e2e specs/06-mermaid.md
git commit -m "feat(mermaid): cinco modelos de diagrama no menu / (M11)"
```

### Task 5: Documentação e versão de teste da 0.11.0

**Files:**
- Modify: `CHANGELOG.md` (seção `## [Unreleased]`), `README.md:119`, `README.pt-BR.md` (linha equivalente do ELK e a frase sobre editar diagramas)
- Modify: `specs/06-mermaid.md` (M9–M11 com ✅)

**Interfaces:** nenhuma.

- [ ] **Step 1: Textos**

CHANGELOG em `[Unreleased]` (o número da versão entra só na publicação): clique duplo leva ao código; cinco modelos no `/`; ELK de volta (com a nota de que o site desenha esses diagramas com o layout padrão). README e README.pt-BR: trocar a linha do ELK pela mesma nota e mencionar o clique duplo onde os diagramas são descritos. Marcar M9–M11 com ✅ no spec.

- [ ] **Step 2: Versão de teste**

Run: `cd packages/extension && timeout 300 npx vsce package --no-dependencies -o /tmp/claude-1000/-home-edtroleis-code-vscode-techdocs-editor/3c69ca0b-7850-4a88-8eca-5bd07b306396/scratchpad/techdocs-editor-0.11.0-teste.vsix`
Expected: `.vsix` com ~3,2 MB. Entregar o caminho ao usuário para instalar no VS Code dele e aprovar antes de qualquer tag.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md README.pt-BR.md specs/06-mermaid.md
git commit -m "docs: clique duplo nos diagramas, cinco modelos e o ELK"
```

A publicação (versão 0.11.0 no `package.json`, seção do CHANGELOG, `test:all`, tag pelo usuário) vem depois da aprovação da versão de teste, fora deste plano.
