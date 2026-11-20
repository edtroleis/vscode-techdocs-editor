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
    expect(locateInDiagram(code, { nodeId: 'D', text: 'Sim' })!.from).toBe(code.lastIndexOf('Sim'));
  });
  it('id que é parte de outra (A e AB): só a palavra inteira', () =>
    expect(pick('flowchart LR\n  AB[Outro] --> A[Este]', { nodeId: 'A', text: 'Este' })).toBe('Este'));
  it('rótulo de seta: pelo texto', () => expect(pick(flow, { text: 'Não' })).toBe('Não'));
  it('rótulo com espaços diferentes do desenho', () =>
    expect(pick('flowchart LR\n  A[Dois   espaços]', { nodeId: 'A', text: 'Dois espaços' })).toBe('Dois   espaços'));
  it('texto com espaços diferentes, sem id', () => expect(pick('sequenceDiagram\n  A->>B: Dois   espaços', { text: 'dois espaços' })).toBe('Dois   espaços'));
  it('front matter fica de fora', () => {
    const code = '---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A[elk] --> B';
    expect(locateInDiagram(code, { nodeId: 'A', text: 'elk' })!.from).toBe(code.indexOf('A[elk]') + 2);
    expect(locateInDiagram(code, { text: 'elk' })!.from).toBe(code.indexOf('A[elk]') + 2);
  });
  it('sequência, estados, Gantt, entidades: pelo texto', () => {
    expect(pick('sequenceDiagram\n  Loja->>Banco: Cobrar pedido', { text: 'Cobrar pedido' })).toBe('Cobrar pedido');
    expect(pick('stateDiagram-v2\n  Criado --> Pago: aprovado', { text: 'Pago' })).toBe('Pago');
    expect(pick('gantt\n  title Migração\n  Cópia de teste :a1, 2026-11-09, 3d', { text: 'Cópia de teste' })).toBe('Cópia de teste');
    expect(pick('erDiagram\n  CLIENTE ||--o{ PEDIDO : faz', { text: 'PEDIDO' })).toBe('PEDIDO');
  });
  it('a linha do tipo não é resultado', () => {
    const r = locateInDiagram('sequenceDiagram\n  A->>B: sequenceDiagram', { text: 'sequenceDiagram' })!;
    expect(r.from).toBeGreaterThan('sequenceDiagram'.length);
  });
  it('comentário antes do tipo', () => expect(pick('%% nota\nflowchart LR\n  A[nota]', { text: 'nota' })).toBe('nota'));
  it('id com hífen: node não casa dentro de my-node', () =>
    expect(pick('flowchart LR\n  my-node[First] --> node[Second]', { nodeId: 'node', text: 'Second' })).toBe('Second'));
  it('texto curto: palavra inteira, não dentro de palavra-chave', () => {
    const code = 'sequenceDiagram\n  participant A\n  A->>B: oi';
    expect(locateInDiagram(code, { text: 'A' })!.from).toBe(code.indexOf('participant A') + 'participant '.length);
  });
  it('texto: maiúsculas exatas antes de ignorar a caixa', () => {
    const code = 'flowchart LR\n  X[título] --> Y[Título]';
    expect(locateInDiagram(code, { text: 'Título' })!.from).toBe(code.lastIndexOf('Título'));
  });
  it('não achou', () => {
    expect(locateInDiagram(flow, { text: '100%' })).toBeUndefined();
    expect(locateInDiagram(flow, { text: '' })).toBeUndefined();
  });
});
