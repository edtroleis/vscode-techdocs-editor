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
