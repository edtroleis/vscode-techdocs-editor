import { describe, expect, it } from 'vitest';
import { docsTree } from './docsTree';
import { filesOnlyUsedBy, findPage, findSection, linkTargets, listForPage, navFromTree, pagesLinkingTo, readNav, setPageTitle, writeNav, type NavItem } from './navEdit';

const YML = `site_name: Wiki # o nome
theme:
  name: material
nav:
  - Início: index.md
  - Guias:
      - guias/a.md
      - Passo B: guias/b.md
  - Site: https://example.com
markdown_extensions:
  - pymdownx.emoji:
      emoji_index: !!python/name:material.extensions.emoji.twemoji
`;

describe('readNav / writeNav', () => {
  it('lê páginas com e sem título, seções e links', () => {
    expect(readNav(YML)).toEqual([
      { kind: 'page', path: 'index.md', title: 'Início' },
      { kind: 'section', title: 'Guias', children: [{ kind: 'page', path: 'guias/a.md' }, { kind: 'page', path: 'guias/b.md', title: 'Passo B' }] },
      { kind: 'link', title: 'Site', url: 'https://example.com' },
    ]);
    expect(readNav('site_name: x\n')).toBeUndefined();
  });

  it('reescreve só o bloco do nav: comentários e tags do resto ficam', () => {
    const nav = readNav(YML)!;
    const [a] = (nav[1] as Extract<NavItem, { kind: 'section' }>).children.splice(0, 1);
    nav.push(a);
    const out = writeNav(YML, nav);
    expect(out).toContain('site_name: Wiki # o nome');
    expect(out).toContain('emoji_index: !!python/name:material.extensions.emoji.twemoji');
    expect(out).toContain('nav:\n  - Início: index.md\n  - Guias:\n      - Passo B: guias/b.md\n  - Site: https://example.com\n  - guias/a.md\nmarkdown_extensions:');
    expect(readNav(out)).toEqual(nav);
  });

  it('sem nav, ele entra no fim', () => {
    expect(writeNav('site_name: x', [{ kind: 'page', path: 'index.md' }])).toBe('site_name: x\nnav:\n  - index.md\n');
  });

  it('o nav no fim do arquivo, sem quebra de linha final', () => {
    expect(writeNav('site_name: x\nnav:\n  - a.md', [{ kind: 'page', path: 'b.md' }])).toBe('site_name: x\nnav:\n  - b.md');
  });

  it('o menu das pastas vira nav com as mesmas seções', () => {
    const tree = docsTree(undefined, ['index.md', 'guias/a.md', 'guias/b.md']);
    expect(navFromTree(tree.nodes)).toEqual([
      { kind: 'page', path: 'index.md' },
      { kind: 'section', title: 'Guias', children: [{ kind: 'page', path: 'guias/a.md' }, { kind: 'page', path: 'guias/b.md' }] },
    ]);
  });

  it('acha página e seção', () => {
    const nav = readNav(YML)!;
    expect(findPage(nav, 'guias/b.md')?.index).toBe(1);
    expect(findSection(nav, ['Guias'])).toEqual({ list: nav, index: 1 });
    expect(findSection(nav, ['Nada'])).toBeUndefined();
  });
});

describe('links e imagens', () => {
  const pages = [
    { path: 'index.md', text: 'Veja [A](guias/a.md#topo) e ![logo](img/logo.png).' },
    { path: 'guias/a.md', text: '![só dela](../img/so-dela.png)\n![logo](../img/logo.png)\n[b]: b.md' },
    { path: 'guias/b.md', text: '<img src="../img/b.png"> [fora](https://x.com/a.md)' },
  ];

  it('resolve os links relativos ao docs_dir', () => {
    expect(linkTargets(pages[1].text, 'guias/a.md')).toEqual(['img/so-dela.png', 'img/logo.png', 'guias/b.md']);
    expect(linkTargets(pages[2].text, 'guias/b.md')).toEqual(['img/b.png']);
  });

  it('quem tem link para a página', () => {
    expect(pagesLinkingTo('guias/a.md', pages)).toEqual(['index.md']);
    expect(pagesLinkingTo('guias/b.md', pages)).toEqual(['guias/a.md']);
  });

  it('as imagens usadas só pela página', () => {
    expect(filesOnlyUsedBy(pages[1], pages)).toEqual(['img/so-dela.png']);
  });
});

describe('setPageTitle', () => {
  it('troca o título 1, fora de bloco de código', () => {
    expect(setPageTitle('```\n# não\n```\n# Velho { #id }\ntexto', 'Novo')).toBe('```\n# não\n```\n# Novo { #id }\ntexto');
  });
  it('troca o title do front matter', () => {
    expect(setPageTitle('---\ntitle: Velho\n---\n# Outro', 'Novo: sim')).toBe('---\ntitle: "Novo: sim"\n---\n# Outro');
  });
  it('sem título, põe um no começo', () => {
    expect(setPageTitle('texto', 'Novo')).toBe('# Novo\n\ntexto');
    expect(setPageTitle('---\na: 1\n---\ntexto', 'Novo')).toBe('---\na: 1\n---\n# Novo\n\ntexto');
  });
});

describe('listForPage', () => {
  const nav: NavItem[] = [
    { kind: 'page', path: 'index.md' },
    { kind: 'section', title: 'Guias', children: [{ kind: 'page', path: 'guias/a.md' }] },
    { kind: 'section', title: 'Operação', children: [{ kind: 'page', path: 'operacao/alertas.md' }] },
  ];

  it('a seção com outra página da mesma pasta', () => {
    expect(listForPage(nav, 'operacao/estorno.md')).toBe((nav[2] as Extract<NavItem, { kind: 'section' }>).children);
  });

  it('sem página da mesma pasta, a raiz do menu', () => {
    expect(listForPage(nav, 'solta.md')).toBe(nav);
    expect(listForPage(nav, 'outra/pagina.md')).toBe(nav);
  });

  it('página da raiz vai para a raiz, mesmo com outra da raiz numa seção', () => {
    const mixed: NavItem[] = [{ kind: 'section', title: 'Guias', children: [{ kind: 'page', path: 'c.md' }] }];
    expect(listForPage(mixed, 'solta.md')).toBe(mixed);
  });
});
