import { configDirs, fixedText, pageProblems } from './lintProblems';

const config = { default: true, MD013: false };

describe('pageProblems', () => {
  const text = '# Página\n\n```\ncódigo\n```\n';

  it('problema com a linha do arquivo e o texto em linguagem simples', () => {
    expect(pageProblems(text, config, 'pt-br')).toEqual([
      { line: 3, rule: 'MD040', message: 'Há um bloco de código sem linguagem definida', fixable: false },
    ]);
  });

  it('em inglês para outras línguas', () => {
    expect(pageProblems(text, config, 'en')[0].message).toBe('There is a code block without a language');
    expect(pageProblems(text, config, 'de')[0].message).toBe('There is a code block without a language');
  });

  it('regra sem texto próprio usa a descrição do markdownlint', () => {
    const [problem] = pageProblems('# Página\n\n<div>html</div>\n', config, 'pt-br');
    expect(problem.rule).toBe('MD033');
    expect(problem.message).toMatch(/^Inline HTML/);
  });

  it('configuração do repositório desliga regras', () => {
    expect(pageProblems(text, { ...config, MD040: false }, 'pt-br')).toEqual([]);
  });

  it('marca o que tem correção automática', () => {
    const [problem] = pageProblems('# Página\n\nTexto.   \n', config, 'pt-br');
    expect(problem).toMatchObject({ rule: 'MD009', fixable: true });
  });
});

describe('fixedText', () => {
  it('corrige o que dá e devolve undefined quando não há o que corrigir', () => {
    expect(fixedText('# Página\n\nTexto.   \n', config)).toBe('# Página\n\nTexto.\n');
    expect(fixedText('# Página\n\nTexto.\n', config)).toBeUndefined();
  });

  it('Título 1 a mais vira Título 2 (correção do editor, MD025)', () => {
    expect(fixedText('# Página\n\n# Seção\n', config)).toBe('# Página\n\n## Seção\n');
  });
});

describe('configDirs', () => {
  it('da pasta do mkdocs.yml até a raiz do workspace', () => {
    expect(configDirs('/w/repo/sub/site', '/w/repo')).toEqual(['/w/repo/sub/site', '/w/repo/sub', '/w/repo']);
    expect(configDirs('/w/repo', '/w/repo/')).toEqual(['/w/repo']);
  });

  it('site fora do workspace (ou em outra pasta do workspace): só a pasta dele', () => {
    expect(configDirs('/outro/site', '/w/repo')).toEqual(['/outro/site']);
    expect(configDirs('/w/repo-2', '/w/repo')).toEqual(['/w/repo-2']);
  });
});
