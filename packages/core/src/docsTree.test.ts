import { docsTree, nameToTitle, pageTitle, siteName } from './docsTree';

const PAGES = ['index.md', 'guias/primeiros-passos.md', 'guias/index.md', 'guias/avancado/b.md', 'processos/aprovacao.md', 'sobre.md'];

describe('docsTree sem nav (pelas pastas)', () => {
  it('index primeiro, páginas, depois as pastas; títulos do nome como o MkDocs', () => {
    expect(docsTree('site_name: X\n', PAGES)).toEqual({
      notInNav: [],
      nodes: [
        { kind: 'page', title: 'Home', path: 'index.md' },
        { kind: 'page', title: 'Sobre', path: 'sobre.md' },
        {
          kind: 'section',
          title: 'Guias',
          children: [
            { kind: 'page', title: 'Guias', path: 'guias/index.md' },
            { kind: 'page', title: 'Primeiros passos', path: 'guias/primeiros-passos.md' },
            { kind: 'section', title: 'Avancado', children: [{ kind: 'page', title: 'B', path: 'guias/avancado/b.md' }] },
          ],
        },
        { kind: 'section', title: 'Processos', children: [{ kind: 'page', title: 'Aprovacao', path: 'processos/aprovacao.md' }] },
      ],
    });
  });

  it('título da página quando há (título 1 ou front matter)', () => {
    const titles: Record<string, string> = { 'index.md': 'Wiki de Demonstração' };
    const [first] = docsTree(undefined, ['index.md'], p => titles[p]).nodes;
    expect(first).toEqual({ kind: 'page', title: 'Wiki de Demonstração', path: 'index.md' });
  });
});

describe('docsTree com nav', () => {
  const yml = `site_name: Wiki
markdown_extensions:
  - pymdownx.emoji:
      emoji_index: !!python/name:material.extensions.emoji.twemoji
extra:
  analytics: !ENV [GOOGLE, 'x']
nav:
  - index.md
  - Guias:
    - Começo: guias/primeiros-passos.md
    - ./guias/avancado/b.md
    - Some: guias/nao-existe.md
  - GitHub: https://github.com/x
  - Manual: assets/manual.pdf
`;

  it('na ordem do nav, com títulos, seções, links e páginas que não existem', () => {
    const tree = docsTree(yml, PAGES, p => (p === 'index.md' ? 'Início' : undefined));
    expect(tree.nodes).toEqual([
      { kind: 'page', title: 'Início', path: 'index.md' },
      {
        kind: 'section',
        title: 'Guias',
        children: [
          { kind: 'page', title: 'Começo', path: 'guias/primeiros-passos.md' },
          { kind: 'page', title: 'B', path: 'guias/avancado/b.md' },
          { kind: 'page', title: 'Some', path: 'guias/nao-existe.md', missing: true },
        ],
      },
      { kind: 'link', title: 'GitHub', url: 'https://github.com/x' },
      { kind: 'link', title: 'Manual', url: 'assets/manual.pdf' },
    ]);
  });

  it('páginas fora do nav à parte', () => {
    expect(docsTree(yml, PAGES).notInNav.map(n => (n.kind === 'page' ? n.path : ''))).toEqual([
      'guias/index.md',
      'processos/aprovacao.md',
      'sobre.md',
    ]);
  });

  it('nome do site', () => {
    expect(siteName(yml)).toBe('Wiki');
    expect(siteName('docs_dir: x\n')).toBeUndefined();
  });
});

describe('pageTitle', () => {
  it('front matter, senão o primeiro título 1 fora de código', () => {
    expect(pageTitle('---\ntitle: "Do meta"\n---\n\n# Do texto\n')).toBe('Do meta');
    expect(pageTitle('```\n# não\n```\n\nTexto.\n\n# Título { #ancora }\n')).toBe('Título');
    expect(pageTitle('## Só título 2\n')).toBeUndefined();
    expect(pageTitle('# Com fecho ##\n')).toBe('Com fecho');
  });

  it('nameToTitle como o MkDocs', () => {
    expect(nameToTitle('primeiros-passos.md')).toBe('Primeiros passos');
    expect(nameToTitle('API_Guia')).toBe('API Guia');
  });
});
