import { addNode, connect, edgeLabel, edgeStyle, isFlowchart, nodeShape, removeEdge, removeNode, reverseEdge, setEdgeStyle, setShape } from './flowchartEdit';

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
  it('removeNode: vários comandos com ; na linha não perde outro nó', () => {
    const code = 'flowchart LR\n  A --> B; C --> D';
    expect(removeNode(code, 'B')).toBe(code);
  });
  it('removeNode: & sem espaços não perde o outro nó', () => {
    const code = 'flowchart LR\n  A&B --> C';
    expect(removeNode(code, 'A')).toBe(code);
  });
  it('removeNode: setas longas, ===, -.- e ~~~', () => {
    expect(removeNode('flowchart LR\n  A[a] ---> B[b]\n  B --> C[c]\n  style B fill:#f00', 'B')).toBe('flowchart LR\n  A[a]\n  C[c]');
    expect(removeNode('flowchart LR\n  A === B ==> C', 'B')).toBe('flowchart LR\n  A\n  C');
    expect(removeNode('flowchart LR\n  A -.- B ~~~ C', 'B')).toBe('flowchart LR\n  A\n  C');
    expect(removeNode('flowchart LR\n  A o--o B --x C', 'B')).toBe('flowchart LR\n  A\n  C');
  });
  it('removeNode: seta com texto que tem hífen', () =>
    expect(removeNode('flowchart LR\n  A[a] -- pre-check --> B[b]', 'B')).toBe('flowchart LR\n  A[a]'));
  it('removeNode: id que aparece fora dos pedaços que entendo: código igual', () => {
    const code = 'flowchart LR\n  A[a] -->> B[b]';
    expect(removeNode(code, 'B')).toBe(code);
  });
  it('connect: seta longa já existente não duplica', () => expect(connect('flowchart LR\n  A ---> C', 'A', 'C', W)).toBeUndefined());
});


describe('formas e setas (M33, M34)', () => {
  const f = 'flowchart TD\n  A[Receber pedido] --> B{Tem estoque?}\n  B -->|Sim| C[Separar]\n  B -- Não --> D';
  it('setShape troca os delimitadores e mantém o texto', () => {
    expect(setShape(f, 'A', 'database')).toContain('A[(Receber pedido)] --> B{Tem estoque?}');
    expect(setShape(f, 'C', 'start')).toContain('B -->|Sim| C([Separar])');
    expect(setShape(f, 'B', 'step')).toContain('A[Receber pedido] --> B[Tem estoque?]');
  });
  it('setShape: documento com a sintaxe @{ } e volta', () => {
    const doc = setShape(f, 'C', 'doc');
    expect(doc).toContain('C@{ shape: doc, label: "Separar" }');
    expect(nodeShape(doc, 'C')).toBe('doc');
    expect(setShape(doc, 'C', 'step')).toContain('C[Separar]');
  });
  it('setShape: nó sem forma ganha a id como texto; :::classe e aspas ficam', () => {
    expect(setShape(f, 'D', 'circle')).toContain('B -- Não --> D((D))');
    expect(setShape('flowchart LR\n  A["a (b)"]:::x --> B', 'A', 'io')).toContain('A[/"a (b)"/]:::x --> B');
  });
  it('setShape: texto com parênteses ganha aspas', () =>
    expect(setShape('flowchart LR\n  A[a (b)]', 'A', 'round')).toContain('A("a (b)")'));
  it('nodeShape: forma atual', () => {
    expect(nodeShape(f, 'A')).toBe('step');
    expect(nodeShape(f, 'B')).toBe('decision');
    expect(nodeShape(f, 'D')).toBe('step');
  });
  it('addNode com forma: texto selecionável', () => {
    const r = addNode(f, 'C', 'database', W);
    expect(r.code).toContain('  C --> N1[(Novo passo)]');
    expect(r.code.slice(r.label.from, r.label.to)).toBe('Novo passo');
    const d = addNode(f, 'C', 'doc', W);
    expect(d.code.slice(d.label.from, d.label.to)).toBe('Novo passo');
  });
  it('setEdgeStyle: pela ordem do desenho, mantém o texto', () => {
    expect(setEdgeStyle(f, 0, 'A', 'B', 'dotted')).toContain('A[Receber pedido] -.-> B{Tem estoque?}');
    expect(setEdgeStyle(f, 1, 'B', 'C', 'thick')).toContain('B ==>|Sim| C[Separar]');
    expect(setEdgeStyle(f, 2, 'B', 'D', 'both')).toContain('B <-->|Não| D');
    expect(edgeStyle(f, 2, 'B', 'D')).toBe('normal');
    expect(edgeStyle('flowchart LR\n  A --- B', 0, 'A', 'B')).toBe('open');
    expect(edgeStyle('flowchart LR\n  A -.-> B', 0, 'A', 'B')).toBe('dotted');
  });
  it('seta que não confere (código mudou) ou linha com &: nada muda', () => {
    expect(setEdgeStyle(f, 0, 'B', 'C', 'thick')).toBeUndefined();
    expect(setEdgeStyle('flowchart LR\n  A & B --> C\n  C --> D', 0, 'A', 'C', 'thick')).toBeUndefined();
    expect(setEdgeStyle('flowchart LR\n  A & B --> C\n  C --> D', 2, 'C', 'D', 'thick')).toContain('C ==> D');
  });
  it('edgeLabel: seleciona o texto que existe ou cria', () => {
    const has = edgeLabel(f, 1, 'B', 'C', 'texto')!;
    expect(has.code.slice(has.label.from, has.label.to)).toBe('Sim');
    const created = edgeLabel(f, 0, 'A', 'B', 'texto')!;
    expect(created.code).toContain('A[Receber pedido] -->|texto| B{Tem estoque?}');
    expect(created.code.slice(created.label.from, created.label.to)).toBe('texto');
  });
  it('removeEdge: os nós ficam', () => {
    expect(removeEdge(f, 0, 'A', 'B')).toBe('flowchart TD\n  A[Receber pedido]\n  B{Tem estoque?}\n  B -->|Sim| C[Separar]\n  B -- Não --> D');
    expect(removeEdge('flowchart LR\n  A --> B --> C', 1, 'B', 'C')).toBe('flowchart LR\n  A --> B\n  C');
  });
  it('reverseEdge: mesmo estilo e texto, no outro sentido', () =>
    expect(reverseEdge(f, 1, 'B', 'C')).toBe('flowchart TD\n  A[Receber pedido] --> B{Tem estoque?}\n  C[Separar]\n  B -- Não --> D\n  C -->|Sim| B'));
});
