import { describe, expect, it } from 'vitest';
import { readableSvg } from './mermaidPreview';

describe('readableSvg (M27)', () => {
  it('min-width de 60% da largura natural, no style que já existe', () => {
    expect(readableSvg('<svg id="a" viewBox="0 0 1000 50" style="max-width: 1000px;"><g/></svg>')).toBe(
      '<svg id="a" viewBox="0 0 1000 50" style="min-width: 600px; max-width: 1000px;"><g/></svg>',
    );
  });
  it('sem style: cria um; sem viewBox: não mexe', () => {
    expect(readableSvg('<svg viewBox="-8 -8 200.5 10"></svg>')).toBe('<svg style="min-width: 120px;" viewBox="-8 -8 200.5 10"></svg>');
    expect(readableSvg('<svg width="10"></svg>')).toBe('<svg width="10"></svg>');
  });
});
