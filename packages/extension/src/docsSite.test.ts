import { hasConflictMarkers, isIgnoredMkdocs, isShownSite, siteFromMkdocs, siteOf } from './docsSite';

describe('siteFromMkdocs', () => {
  it('sem docs_dir, as páginas ficam em docs/', () => {
    expect(siteFromMkdocs('/w/wiki/mkdocs.yml', 'site_name: Wiki\n')).toEqual({ root: '/w/wiki', docsDir: '/w/wiki/docs' });
  });

  it('docs_dir com aspas, ./ e barra no fim', () => {
    expect(siteFromMkdocs('/w/mkdocs.yml', "docs_dir: './paginas/'\n").docsDir).toBe('/w/paginas');
  });
});

describe('siteOf', () => {
  const sites = [
    { root: '/w', docsDir: '/w/docs' },
    { root: '/w/docs/sub', docsDir: '/w/docs/sub/docs' },
    { root: '/w/outra', docsDir: '/w/outra/docs' },
  ];

  it('página dentro do docs_dir', () => {
    expect(siteOf('/w/docs/guias/a.md', sites)).toBe(sites[0]);
    expect(siteOf('/w/outra/docs/index.md', sites)).toBe(sites[2]);
  });

  it('sites aninhados: vale o mais interno', () => {
    expect(siteOf('/w/docs/sub/docs/index.md', sites)).toBe(sites[1]);
  });

  it('fora do docs_dir, ou nome só parecido, ou não é .md', () => {
    expect(siteOf('/w/README.md', sites)).toBeUndefined();
    expect(siteOf('/w/docs-antigas/a.md', sites)).toBeUndefined();
    expect(siteOf('/w/docs/imagem.png', sites)).toBeUndefined();
  });

  it('extensão em maiúsculas', () => {
    expect(siteOf('/w/docs/LEIAME.MD', sites)).toBe(sites[0]);
  });
});

describe('hasConflictMarkers', () => {
  it('conflito do Git', () => {
    expect(hasConflictMarkers('# T\n\n<<<<<<< HEAD\nmeu\n=======\ndeles\n>>>>>>> main\n')).toBe(true);
  });

  it('com CRLF e sem nome depois do marcador', () => {
    expect(hasConflictMarkers('<<<<<<<\r\nmeu\r\n=======\r\ndeles\r\n>>>>>>>\r\n')).toBe(true);
  });

  it('linhas soltas parecidas não contam', () => {
    expect(hasConflictMarkers('# T\n\nTítulo\n=======\n')).toBe(false);
    expect(hasConflictMarkers('a <<<<<<< b\n=======\n>>>>>>> c\n')).toBe(false);
    expect(hasConflictMarkers('>>>>>>> main\n=======\n<<<<<<< HEAD\n')).toBe(false);
  });
});

describe('isIgnoredMkdocs', () => {
  it('site normal: na raiz ou numa pasta', () => {
    expect(isIgnoredMkdocs('mkdocs.yml', 'site_name: Wiki\n')).toBe(false);
    expect(isIgnoredMkdocs('backstage/repos/wiki/mkdocs.yml', 'site_name: Wiki\n')).toBe(false);
  });

  it('pastas ocultas, dependências, builds e fixtures', () => {
    for (const path of [
      'vscode-techdocs-editor/.claude/worktrees/x/mkdocs.yml',
      '.vscode-test/mkdocs.yml',
      'app/node_modules/pkg/mkdocs.yml',
      'app/dist/mkdocs.yml',
      'app/test/fixtures/wiki/mkdocs.yml',
      'plugin/e2e/portal/wiki-fixture/mkdocs.yml',
    ]) {
      expect(isIgnoredMkdocs(path, 'site_name: Wiki\n'), path).toBe(true);
    }
  });

  it('esqueleto de template do Backstage ou do cookiecutter', () => {
    expect(isIgnoredMkdocs('templates/docs/skeleton/mkdocs.yml', 'site_name: ${{ values.titulo }}\n')).toBe(true);
    expect(isIgnoredMkdocs('t/mkdocs.yml', 'site_name: {{ cookiecutter.name }}\n')).toBe(true);
  });
});

describe('isShownSite', () => {
  it('sem escolha ou com a lista vazia: todos', () => {
    expect(isShownSite('a/wiki', undefined)).toBe(true);
    expect(isShownSite('a/wiki', null)).toBe(true);
    expect(isShownSite('a/wiki', [])).toBe(true);
  });

  it('a pasta escolhida ou uma acima dela; nome só parecido não vale', () => {
    const chosen = ['backstage/repos/techdocs-wikis', './docs-editor-demo/wiki-demo/'];
    expect(isShownSite('backstage/repos/techdocs-wikis/ia', chosen)).toBe(true);
    expect(isShownSite('docs-editor-demo/wiki-demo', chosen)).toBe(true);
    expect(isShownSite('backstage/repos/techdocs-wikis-old', chosen)).toBe(false);
    expect(isShownSite('backstage/templates', chosen)).toBe(false);
  });

  it('site na raiz do workspace', () => {
    expect(isShownSite('.', ['.'])).toBe(true);
    expect(isShownSite('.', ['docs'])).toBe(false);
  });
});
