import { apiBaseUrlFor, branchFor, parseGitHubRemote } from './publish';

describe('branchFor', () => {
  it('uma branch por pessoa e por arquivo, sem caracteres que o Git recusa', () => {
    expect(branchFor('ana', 'docs/guias/Primeiros passos.md')).toBe('docs/ana/docs-guias-Primeiros-passos');
  });

  it('padrão configurado', () => {
    expect(branchFor('ana', 'docs/index.md', 'wiki/{path}-{login}')).toBe('wiki/docs-index-ana');
  });
});

describe('parseGitHubRemote', () => {
  it.each([
    ['https://github.com/acme/wiki.git', 'github.com', 'acme/wiki'],
    ['https://github.com/acme/wiki', 'github.com', 'acme/wiki'],
    ['https://token@github.com/acme/wiki.git', 'github.com', 'acme/wiki'],
    ['git@github.com:acme/wiki.git', 'github.com', 'acme/wiki'],
    ['ssh://git@github.com/acme/wiki.git', 'github.com', 'acme/wiki'],
    ['ssh://git@ghe.empresa.com:2222/time/docs', 'ghe.empresa.com', 'time/docs'],
    ['https://GHE.empresa.com/time/docs.git/', 'ghe.empresa.com', 'time/docs'],
  ])('%s', (url, host, slug) => {
    expect(parseGitHubRemote(url)).toEqual({ host, slug });
  });

  it.each(['/srv/git/wiki.git', 'file:///srv/git/wiki.git', 'C:\\repos\\wiki', 'https://github.com/so-dono'])(
    'não é repositório do GitHub: %s',
    url => {
      expect(parseGitHubRemote(url)).toBeUndefined();
    },
  );
});

describe('apiBaseUrlFor', () => {
  it('github.com e Enterprise', () => {
    expect(apiBaseUrlFor('github.com')).toBe('https://api.github.com');
    expect(apiBaseUrlFor('ghe.empresa.com')).toBe('https://ghe.empresa.com/api/v3');
  });
});
