import { rebase } from './rebase';

describe('rebase', () => {
  const base = '# Título\n\nUm.\n\nDois.\n\nTrês.\n';

  it('sem mudança no visual, o documento fica como está', () => {
    expect(rebase(base, base, '# Título\n\n\n\nUm.\n')).toBe('# Título\n\n\n\nUm.\n');
  });

  it('documento igual ao do editor: vale o texto do editor', () => {
    expect(rebase(base, base.replace('Um.', 'Um!'), base)).toBe(base.replace('Um.', 'Um!'));
  });

  it('só o trecho mudado no visual entra; o resto do documento não é reformatado', () => {
    // O documento tem formatação que o editor normalizaria (espaços no fim, linhas em branco a mais)
    const document = '# Título\n\nUm.   \n\nDois.\n\n\n\nTrês.\n';
    const after = base.replace('Dois.', 'Dois e meio.');
    expect(rebase(base, after, document)).toBe('# Título\n\nUm.   \n\nDois e meio.\n\n\n\nTrês.\n');
  });

  it('mudança feita por fora em outro trecho continua', () => {
    const document = base.replace('Três.', 'Três (do texto).');
    const after = base.replace('Um.', 'Um (do visual).');
    expect(rebase(base, after, document)).toBe('# Título\n\nUm (do visual).\n\nDois.\n\nTrês (do texto).\n');
  });

  it('as duas no mesmo trecho: vale a do visual', () => {
    const document = base.replace('Dois.', 'Dois (do texto).');
    const after = base.replace('Dois.', 'Dois (do visual).');
    expect(rebase(base, after, document)).toContain('Dois (do visual).');
    expect(rebase(base, after, document)).not.toContain('Dois (do texto).');
  });
});
