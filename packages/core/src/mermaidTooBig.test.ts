import { describe, expect, it } from 'vitest';
import { mermaidTooBig } from './mermaidConfig';

describe('mermaidTooBig (M27)', () => {
  const chain = (n: number) => `flowchart LR\n${Array.from({ length: n }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')}`;
  it('fluxograma com mais de 500 ligações, ou mais de 50 mil caracteres', () => {
    expect(mermaidTooBig(chain(500))).toBe(false);
    expect(mermaidTooBig(chain(501))).toBe(true);
    expect(mermaidTooBig(`sequenceDiagram\n${'  A->>B: oi\n'.repeat(600)}`)).toBe(false);
    expect(mermaidTooBig(`pie\n${'  "x" : 1\n'.repeat(6000)}`)).toBe(true);
  });
});
