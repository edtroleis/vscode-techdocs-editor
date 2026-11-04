import { vi } from 'vitest';

// O Mermaid de verdade precisa de DOM: aqui só importa a fila (um pedido que nunca termina não pode travar os outros)
const parse = vi.fn();
vi.mock('mermaid', () => ({ default: { initialize: () => undefined, parse: (code: string) => parse(code), render: vi.fn() } }));

describe('fila dos diagramas', () => {
  afterEach(() => vi.useRealTimers());

  it('um parse que nunca termina não trava os pedidos seguintes', async () => {
    vi.useFakeTimers();
    const { diagramErrors } = await import('./mermaidPreview');
    parse.mockImplementationOnce(() => new Promise(() => undefined));
    parse.mockImplementation(async () => undefined);
    const stuck = diagramErrors([{ line: 1, code: 'flowchart LR\n  A-->B' }]);
    const next = diagramErrors([{ line: 1, code: 'flowchart LR\n  C-->D' }]);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(stuck).rejects.toThrow();
    await expect(next).resolves.toEqual([]);
  });
});
