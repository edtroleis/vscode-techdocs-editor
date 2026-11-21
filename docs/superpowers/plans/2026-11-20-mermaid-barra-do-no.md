# Mermaid: barra do nó no fluxograma — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na 0.12.0, clique simples num nó de fluxograma mostra + Passo depois, + Decisão, Ligar a… e Apagar, que mudam o código do diagrama sem estragar o resto.

**Architecture:** Um módulo puro (`flowchartEdit.ts`) muda o texto do fluxograma linha a linha, reaproveitando o `diagramSource.ts`. Um plugin ProseMirror (`diagramNodeBar.ts`) mostra a barra, valida o código novo com o `parse` do Mermaid e troca o conteúdo do bloco numa só transação; depois de criar um nó, abre o código no rótulo novo com a mesma função do clique duplo.

**Tech Stack:** TypeScript, Milkdown/Crepe 7.22, Mermaid 12.2, CodeMirror 6 (`@codemirror/view`), Vitest, Playwright (`test:editor`).

**Spec:** `specs/06-mermaid.md` (itens M12–M16 e "M12 a M16: decisões (2026-11-20)").

## Global Constraints

- Commits só em nome do usuário, sem `Co-Authored-By`, em pt-BR no padrão do repositório.
- Textos em pt-BR e inglês em `packages/ui/src/messages/` (pt-BR: "diretório", nunca "pasta").
- No dia a dia, só os testes da mudança, sempre com `timeout`; antes da release, `test:all` e `test:scenarios` completos com `timeout`.
- Só fluxograma (`flowchart`/`graph` na linha do tipo, depois do front matter); nada no modo leitura (`view.editable` falso).
- Textos fixos: pt-BR "+ Passo depois", "+ Decisão", "Ligar a…", "Apagar", "Novo passo", "Nova decisão?", "Sim", "Não", "Clique no nó de destino (Esc cancela)", "Não deu para mudar o diagrama automaticamente; edite o código"; en "+ Step after", "+ Decision", "Connect to…", "Delete", "New step", "New decision?", "Yes", "No", "Click the target node (Esc cancels)", "Couldn't change the diagram automatically; edit the code".
- Cada ação é uma transação (um Ctrl+Z) e só é aplicada se o código novo passa no `parse` do Mermaid.

## Review Focus

- Clique duplo num nó: os dois cliques simples antes dele abrem a barra; ela tem de fechar quando o clique duplo abre o código (Task 3).
- Nó definido dentro de um `subgraph … end`: a linha nova vai no fim do código, fora do subgrafo, e o diagrama continua válido (Task 1).
- Bloco que rola ou redesenha com a barra aberta (digitar no código redesenha a prévia): a barra fecha em vez de ficar solta na tela (Task 3).
- Modo Ligar ativo e a pessoa clica em outro bloco ou digita no texto: o modo cancela e a dica volta (Task 3).
- Apagar o último nó de um fluxograma: o código fica só com a linha do tipo, que o Mermaid aceita (Task 1).

---

### Task 1: Mudar o fluxograma pelo código (`flowchartEdit.ts`)

**Files:**
- Modify: `packages/ui/src/diagramSource.ts` (exportar `bodyLines`, `idPattern`, `type Line`)
- Create: `packages/ui/src/flowchartEdit.ts`
- Test: `packages/ui/src/flowchartEdit.test.ts`

**Interfaces:**
- Consumes: `bodyLines(code): { type: string; lines: Line[] }`, `idPattern(id): string`, `CodeRange` (de `diagramSource.ts`).
- Produces:
  - `export type FlowchartWords = { step: string; decision: string; yes: string; no: string }`
  - `export function isFlowchart(code: string): boolean`
  - `export function addNode(code: string, from: string, kind: 'step' | 'decision', words: FlowchartWords): { code: string; label: CodeRange }`: `label` é o trecho do texto do nó novo no código novo.
  - `export function connect(code: string, from: string, to: string, words: FlowchartWords): string | undefined`: `undefined` se a seta `from → to` já existe ou `from === to`.
  - `export function removeNode(code: string, id: string): string`

Regras (fixadas pelos testes):
1. Setas reconhecidas num comando: `-->`, `---`, `-.->`, `==>`, `--o`, `--x`, `<-->`, com rótulo `|texto|` depois da seta ou `-- texto -->` / `== texto ==>` / `-. texto .->`. Um comando é uma linha; `;` no fim é ignorado.
2. Decisão: o nó tem forma `{…}` (não `{{…}}`) em alguma linha.
3. Setas que saem de `from`: contar as setas cujo lado esquerdo é `from` (palavra inteira, `idPattern`). Rótulo da nova seta, se `from` é decisão: 0 → `words.yes`, 1 → `words.no`, 2+ → nenhum. Com rótulo: `from -- Sim --> …`.
4. Id nova: `N<k>`, o menor `k ≥ 1` que não aparece como palavra inteira no código.
5. Linha nova no fim do código (depois da última linha não vazia; antes de uma quebra de linha final, se houver), com o recuo da última linha não vazia do corpo, ou 2 espaços.
6. `removeNode`: em cada linha, os pedaços separados por setas; tira o pedaço do nó e as setas ligadas a ele; os pedaços que sobram de cada lado viram linhas próprias, com o recuo da linha original; linhas `style id …`, `class id …`, `click id …` saem; linha vazia sai.

- [ ] **Step 1: Testes**

```ts
import { addNode, connect, isFlowchart, removeNode } from './flowchartEdit';

const W = { step: 'Novo passo', decision: 'Nova decisão?', yes: 'Sim', no: 'Não' };
const flow = 'flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Fim]';

describe('flowchartEdit', () => {
  it('isFlowchart: flowchart e graph, com front matter; não sequência', () => {
    expect(isFlowchart(flow)).toBe(true);
    expect(isFlowchart('---\ntitle: x\n---\ngraph TD\n  A-->B')).toBe(true);
    expect(isFlowchart('sequenceDiagram\n  A->>B: oi')).toBe(false);
  });
  it('passo depois de um passo: id livre, recuo, rótulo selecionável', () => {
    const r = addNode(flow, 'C', 'step', W);
    expect(r.code).toBe(flow + '\n  C --> N1[Novo passo]');
    expect(r.code.slice(r.label.from, r.label.to)).toBe('Novo passo');
  });
  it('id livre pula as usadas', () => expect(addNode('flowchart LR\n  N1 --> N2', 'N2', 'step', W).code).toContain('N2 --> N3[Novo passo]'));
  it('decisão: Sim na 1ª seta, Não na 2ª, nada na 3ª', () => {
    const d = 'flowchart LR\n  B{Ok?}';
    const one = addNode(d, 'B', 'decision', W).code;
    expect(one).toContain('B -- Sim --> N1{Nova decisão?}');
    const two = addNode(one, 'B', 'step', W).code;
    expect(two).toContain('B -- Não --> N2[Novo passo]');
    expect(addNode(two, 'B', 'step', W).code).toContain('  B --> N3[Novo passo]');
  });
  it('mantém a quebra de linha final', () => expect(addNode(flow + '\n', 'C', 'step', W).code).toBe(flow + '\n  C --> N1[Novo passo]\n'));
  it('nó em subgrafo: linha nova no fim', () => {
    const sub = 'flowchart LR\n  subgraph S\n    A --> B\n  end';
    expect(addNode(sub, 'B', 'step', W).code).toBe(sub + '\n  B --> N1[Novo passo]');
  });
  it('connect: acrescenta, usa Sim/Não, não duplica nem liga a si mesmo', () => {
    expect(connect(flow, 'A', 'C', W)).toBe(flow + '\n  A --> C');
    expect(connect(flow, 'B', 'A', W)).toBe(flow + '\n  B -- Não --> A');
    expect(connect(flow, 'B', 'C', W)).toBeUndefined();
    expect(connect(flow, 'A', 'A', W)).toBeUndefined();
  });
  it('removeNode: nó no fim da cadeia', () => expect(removeNode(flow, 'C')).toBe('flowchart LR\n  A[Início] --> B{Decisão}'));
  it('removeNode: no meio da cadeia, os vizinhos ficam com a definição', () =>
    expect(removeNode('flowchart LR\n  A[x] --> B[y] --> C', 'B')).toBe('flowchart LR\n  A[x]\n  C'));
  it('removeNode: setas com rótulo e style/class/click', () => {
    const code = 'flowchart LR\n  A -- sim --> B\n  A -->|não| C\n  style B fill:#f00\n  class B x\n  click B "https://x"\n  %% nota';
    expect(removeNode(code, 'B')).toBe('flowchart LR\n  A\n  A -->|não| C\n  %% nota');
  });
  it('removeNode: id com hífen não leva my-node junto', () =>
    expect(removeNode('flowchart LR\n  my-node --> node', 'node')).toBe('flowchart LR\n  my-node'));
  it('removeNode: o último nó deixa só o tipo', () => expect(removeNode('flowchart LR\n  A[Só]', 'A')).toBe('flowchart LR'));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `timeout 120 npx vitest run packages/ui/src/flowchartEdit.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Exportar `bodyLines`, `idPattern`, `Line` do `diagramSource.ts` e implementar `flowchartEdit.ts`**
- [ ] **Step 4: Rodar e ver passar** — o mesmo comando e `timeout 120 npx vitest run packages/ui/src/diagramSource.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(mermaid): mudar o fluxograma pelo código (M13–M15)"`.

### Task 2: A barra do nó no editor (M12–M16)

**Files:**
- Create: `packages/ui/src/diagramNodeBar.ts`
- Modify: `packages/ui/src/diagramDoubleClick.ts` (extrair `openCodeAt`), `packages/ui/src/mermaidPreview.ts` (`isValidDiagram`, `DiagramText` com os textos da barra), `packages/ui/src/labels.ts`, `packages/ui/src/messages/pt-BR.ts`, `en.ts`, `packages/ui/src/editor.css`, `packages/ui/src/MarkdownEditor.tsx` (`.use(diagramNodeBarPlugin)`)
- Test: `packages/ui/e2e/tests/mermaid-node-bar.spec.ts`

**Interfaces:**
- Consumes: `isFlowchart`, `addNode`, `connect`, `removeNode`, `FlowchartWords` (Task 1); `targetFromElement` (já existe).
- Produces:
  - `export function openCodeAt(view: EditorView, block: Element, pos: number, range: CodeRange): void` em `diagramDoubleClick.ts` (o corpo de hoje do clique duplo, depois de achar `pos` e `range`; o clique duplo passa a chamá-la).
  - `export function isValidDiagram(code: string): Promise<boolean>` em `mermaidPreview.ts` (pela fila `enqueue`, `parse` do Mermaid).
  - `DiagramText` ganha `bar: { step: string; decision: string; connect: string; remove: string; connectHint: string; failed: string }` e `words: FlowchartWords`.
  - `export const diagramBarCtx = createSlice<{ bar: DiagramText['bar']; words: FlowchartWords }>(…, 'docsEditorDiagramBar')`, preenchido no `MarkdownEditor.tsx` a partir de `labels.diagram` (como o `diagramInsertCtx`).
  - `export const diagramNodeBarPlugin` (`$prose`), que lê os textos do `diagramBarCtx`.

Comportamento:
- Listener `click` no `view.dom` (como o clique duplo: o node view para os eventos). Abre a barra se `view.editable`, o alvo está num `g.node` dentro de `.mermaid-diagram`, o bloco é `code_block` e `isFlowchart(textContent)`; a id vem de `targetFromElement`.
- A barra é um `div.mermaid-node-bar` com `role="toolbar"` e quatro `button`, presa ao `document.body` com `position: fixed`, centrada acima do `g.node` (`getBoundingClientRect`), dentro da janela. Fecha com: clique fora dela e fora de um nó, Esc, `scroll`/`resize` da janela, `dblclick`, qualquer mudança do documento (`update` do plugin com `docChanged`), e depois de cada ação.
- Ação: lê o código do nó **na hora**, calcula o novo, `await isValidDiagram(novo)`; se o nó ou o código mudaram no meio, desiste; se inválido, põe `bar.failed` na `.mermaid-hint` do bloco com a classe `mermaid-hint-error` e `role="status"` por 6 s; se válido, `tr.replaceWith(pos + 1, pos + 1 + node.content.size, schema.text(novo))` e `dispatch`. Em `addNode`, depois do `dispatch`, `openCodeAt(view, block, pos, label)`.
- Ligar a…: guarda `{ pos, from }`, troca o texto da `.mermaid-hint` por `bar.connectHint` e põe `cursor: crosshair` no `.mermaid-diagram`; o próximo clique num `g.node` do mesmo bloco chama `connect`; clique em outro lugar, Esc ou mudança do documento cancelam e devolvem a dica.

- [ ] **Step 1: Testes do editor** (`mermaid-node-bar.spec.ts`; `flow` e `page1` como no `mermaid.spec.ts`; `node = (page, t) => block(page).locator('.mermaid-diagram g.node', { hasText: t })`; `bar = page.locator('.mermaid-node-bar')`)

```ts
test('clique num nó do fluxograma mostra a barra; + Passo depois abre o código no nome novo', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Fim').click();
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: '+ Passo depois' }).click();
  await expect(bar).toBeHidden();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await page.keyboard.type('Enviar');
  await expect.poll(() => saved(page)).toBe(page1('flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Fim]\n  C --> N1[Enviar]'));
});
test('+ Decisão saindo de decisão leva Não (a 1ª seta já existe); Ctrl+Z desfaz de uma vez', ...);
  // node 'Decisão' → '+ Decisão' → saved termina com '  B -- Não --> N1{Nova decisão?}'; Escape no código, Control+z até saved === flow (no máximo 2 Ctrl+Z: digitar nada + a ação)
test('Ligar a… liga ao nó clicado em seguida, com a dica trocada', ...);
  // node 'Início' → 'Ligar a…' → hint 'Clique no nó de destino (Esc cancela)' → node 'Fim' → saved termina com '  A --> C'; hint volta ao texto original
test('Ligar a… com Esc cancela', ...);
test('Apagar tira o nó e as setas dele', ...);
  // node 'Fim' → 'Apagar' → saved === page1('flowchart LR\n  A[Início] --> B{Decisão}')
test('linha com & : a mensagem aparece e nada muda', ...);
  // page1('flowchart LR\n  A & B --> C') ; node 'C' → 'Apagar' → hint 'Não deu para mudar o diagrama automaticamente; edite o código'; saved undefined
test('clique duplo fecha a barra e abre o código', ...);
test('sequência e modo leitura: sem barra', ...);
  // page1('sequenceDiagram\n  A->>B: oi') clique em 'oi' → bar hidden; /?readonly=1 com flow, clique em 'Fim' → bar hidden
test('digitar no código redesenha e fecha a barra', ...);
```

(Os testes sem corpo seguem o padrão do primeiro; os comentários dizem a entrada e o que conferir.)

- [ ] **Step 2: Rodar e ver falhar** — `timeout 300 npm run test:editor -- mermaid-node-bar.spec.ts` → FAIL (sem barra).
- [ ] **Step 3: Textos, `isValidDiagram`, `openCodeAt`, `diagramNodeBar.ts`, CSS (botões como os do bloco do Crepe: `--crepe-color-surface`, borda, sombra; `.mermaid-hint-error` com `--crepe-color-error`) e registro no editor**
- [ ] **Step 4: Rodar e ver passar** — `timeout 300 npm run test:editor -- mermaid-node-bar.spec.ts mermaid.spec.ts` → PASS; `timeout 120 npm run typecheck` sem erro.
- [ ] **Step 5: Commit** — `git commit -m "feat(mermaid): barra do nó no fluxograma (M12–M16)"`.

### Task 3: Documentação, vídeo e versão de teste

**Files:**
- Modify: `README.md`, `README.pt-BR.md` (seção dos diagramas), `CHANGELOG.md` (`[Unreleased]`), `packages/extension/e2e/videos/walkthrough.spec.ts` (cena `mermaid`), `specs/06-mermaid.md` (M12–M16 com ✅)

- [ ] **Step 1: Textos** — README: "Click a node of a flowchart for **+ Step after**, **+ Decision**, **Connect to…** and **Delete**" (e o equivalente em pt-BR); CHANGELOG em `[Unreleased]`, Added.
- [ ] **Step 2: Cena do vídeo** — depois do clique duplo em "Decision", legenda "Click a node: add the next step, a decision, connect or delete", clique em "End" e "+ Step after", digitar "Receipt sent" (substitui o trecho que hoje acrescenta `C --> D[Receipt sent]` à mão).
- [ ] **Step 3: Versão de teste** — `cd packages/extension && timeout 300 npx vsce package --no-dependencies -o <scratchpad>/techdocs-editor-0.12.0-teste.vsix` → `.vsix` gerado; entregar ao usuário.
- [ ] **Step 4: Commit** — `git commit -m "docs: barra do nó nos diagramas"`.

A release (versão 0.12.0, `record:videos`, `test:all` e cenários com `timeout`, merge e tag pelo usuário) vem depois da aprovação da versão de teste.
