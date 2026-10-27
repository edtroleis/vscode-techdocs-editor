import { minimalEdit, toEol, toLf } from './textSync';

const apply = (before: string, edit: ReturnType<typeof minimalEdit>) =>
  before.slice(0, edit.start) + edit.text + before.slice(edit.end);

describe('minimalEdit', () => {
  it.each([
    ['igual', 'abc', 'abc'],
    ['inserção no meio', '# Título\n\nTexto.\n', '# Título\n\nTexto novo.\n'],
    ['remoção', '# Título\n\nUm\n\nDois\n', '# Título\n\nDois\n'],
    ['troca de tudo', 'abc', 'xyz'],
    ['de vazio', '', '# Novo\n'],
    ['para vazio', '# Velho\n', ''],
    ['repetições (prefixo e sufixo se sobrepõem)', 'aaa', 'aaaa'],
    ['repetições ao contrário', 'aaaa', 'aa'],
  ])('%s', (_name, before, after) => {
    const edit = minimalEdit(before, after);
    expect(apply(before, edit)).toBe(after);
    expect(edit.end).toBeGreaterThanOrEqual(edit.start);
  });

  it('troca só o trecho alterado', () => {
    expect(minimalEdit('# T\n\nTexto.\n', '# T\n\nTexto novo.\n')).toEqual({ start: 10, end: 10, text: ' novo' });
  });
});

describe('fins de linha', () => {
  it('CRLF vai ao editor como LF e volta como CRLF', () => {
    const file = '# T\r\n\r\nTexto.\r\n';
    expect(toLf(file)).toBe('# T\n\nTexto.\n');
    expect(toEol(toLf(file), '\r\n')).toBe(file);
  });
});
