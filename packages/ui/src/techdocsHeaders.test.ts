import { formatAdmonition, formatTab, kindStyle, parseAdmonition, parseTab } from './techdocsHeaders';

describe('cabeçalhos dos componentes', () => {
  it.each([
    '!!! tip "Comece pelo contrato"',
    '??? note "Saiba mais"',
    '???+ warning',
    '!!! note inline end "Lado"',
    '!!! info ""',
    '!!! danger "Use `x` com \\"cuidado\\""',
  ])('%s volta igual', header => {
    expect(formatAdmonition(parseAdmonition(header)!)).toBe(header);
  });
  it('lê marcador, tipo, classes e título', () => {
    expect(parseAdmonition('???+ note inline end "Lado"')).toEqual({ marker: '???+', kind: 'note', extra: ' inline end', title: 'Lado' });
    expect(parseAdmonition('!!! tip')).toEqual({ marker: '!!!', kind: 'tip', extra: '', title: null });
    expect(parseAdmonition('!!! "sem tipo"')).toBeUndefined();
  });
  it('trocar tipo e título', () => {
    const h = parseAdmonition('!!! tip "Dica"')!;
    expect(formatAdmonition({ ...h, kind: 'warning' })).toBe('!!! warning "Dica"');
    expect(formatAdmonition({ ...h, marker: '???' })).toBe('??? tip "Dica"');
    expect(formatAdmonition({ ...h, title: null })).toBe('!!! tip');
  });
  it('abas', () => {
    expect(parseTab('=== "Linux"')).toEqual({ selected: false, title: 'Linux' });
    expect(parseTab('===+ "Windows"')).toEqual({ selected: true, title: 'Windows' });
    expect(formatTab({ selected: false, title: 'macOS' })).toBe('=== "macOS"');
    expect(parseTab('=== Linux')).toBeUndefined();
  });
  it('cor do tipo: apelidos e desconhecido', () => {
    expect(kindStyle('Tip')).toBe('tip');
    expect(kindStyle('caution')).toBe('warning');
    expect(kindStyle('tldr')).toBe('abstract');
    expect(kindStyle('qualquer')).toBe('note');
  });
});
