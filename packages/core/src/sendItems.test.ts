import { describe, expect, it } from 'vitest';
import { isDocsFile, itemCount, itemPaths, sendGroups, sendSummary, siteOf, type SendSite } from './sendItems';

const GUIA: SendSite = { root: '', docsDir: 'docs', mkdocs: 'mkdocs.yml', title: 'Guia' };
const API: SendSite = { root: 'api', docsDir: 'api/docs', mkdocs: 'api/mkdocs.yml', title: 'API' };
const SITES = [GUIA, API];

const PT: Record<string, string> = {
  'updates {0}': 'atualiza {0}',
  'creates {0}': 'cria {0}',
  'removes {0}': 'remove {0}',
  'moves {0}': 'move {0}',
  'updates the menu': 'atualiza o menu',
  'adds images': 'acrescenta imagens',
  '{0} and {1}': '{0} e {1}',
};
const t = (msg: string, ...args: Array<string | number>) =>
  (PT[msg] ?? msg).replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));

describe('arquivos da documentação', () => {
  it('o docs_dir, o mkdocs.yml e os arquivos do site são da documentação; o resto não', () => {
    for (const path of ['docs/a.md', 'docs/assets/x.png', 'mkdocs.yml', 'catalog-info.yaml', 'api/.markdownlint.yaml', 'api/docs/index.md', '.techdocs-editor.yaml'])
      expect(isDocsFile(path, SITES), path).toBe(true);
    for (const path of ['src/x.ts', 'README.md', 'package.json', 'api/src/y.ts'])
      expect(isDocsFile(path, SITES), path).toBe(false);
  });

  it('o site de um arquivo é o mais fundo que o contém', () => {
    expect(siteOf('api/docs/index.md', SITES)).toBe(API);
    expect(siteOf('docs/index.md', SITES)).toBe(GUIA);
  });
});

describe('itens do envio', () => {
  const texts: Record<string, string> = {
    'docs/Visão Geral.md': '# Visão Geral\n\n![a](assets/a.png) ![b](assets/b.png)\n',
    'docs/faq.md': '# Perguntas frequentes\n',
    'docs/operacao/alertas.md': '# Alertas\n',
  };
  const { groups, outside } = sendGroups(
    [
      { path: 'docs/faq.md', status: 'added' },
      { path: 'src/x.ts', status: 'modified' },
      { path: 'mkdocs.yml', status: 'modified' },
      { path: 'docs/v1.md', status: 'deleted' },
      { path: 'docs/assets/a.png', status: 'added' },
      { path: 'docs/Visão Geral.md', status: 'modified' },
      { path: 'docs/operacao/alertas.md', status: 'renamed', from: 'docs/alertas.md' },
      { path: 'docs/assets/b.png', status: 'added' },
    ],
    SITES,
    path => texts[path],
  );

  it('agrupa por site, na ordem alteradas, novas, movidas, removidas, imagens, menu; o de fora fica de fora', () => {
    expect(outside).toEqual(['src/x.ts']);
    expect(groups.map(g => g.site.title)).toEqual(['Guia']);
    expect(groups[0].items).toEqual([
      { kind: 'page', change: 'modified', path: 'docs/Visão Geral.md', site: '', title: 'Visão Geral' },
      { kind: 'page', change: 'added', path: 'docs/faq.md', site: '', title: 'Perguntas frequentes' },
      { kind: 'moved', from: 'docs/alertas.md', path: 'docs/operacao/alertas.md', site: '', title: 'Alertas' },
      { kind: 'page', change: 'deleted', path: 'docs/v1.md', site: '', title: 'V1' },
      { kind: 'images', paths: ['docs/assets/a.png', 'docs/assets/b.png'], site: '', usedIn: ['docs/Visão Geral.md'] },
      { kind: 'menu', path: 'mkdocs.yml', site: '' },
    ]);
    expect(itemCount(groups)).toBe(6);
    expect(itemPaths(groups[0].items[2])).toEqual(['docs/alertas.md', 'docs/operacao/alertas.md']);
  });

  it('a mesma página em dois sites vira dois grupos', () => {
    const two = sendGroups(
      [
        { path: 'docs/index.md', status: 'modified' },
        { path: 'api/docs/index.md', status: 'modified' },
      ],
      SITES,
      () => undefined,
    ).groups;
    expect(two.map(g => [g.site.title, g.items.map(itemPaths)])).toEqual([
      ['Guia', [['docs/index.md']]],
      ['API', [['api/docs/index.md']]],
    ]);
  });

  it('o resumo diz o que muda, por site', () => {
    const one = sendGroups(
      [
        { path: 'docs/Visão Geral.md', status: 'modified' },
        { path: 'docs/faq.md', status: 'added' },
      ],
      SITES,
      path => texts[path],
    ).groups;
    expect(sendSummary(one, t)).toBe('Atualiza Visão Geral; cria Perguntas frequentes');
    const two = sendGroups(
      [
        { path: 'docs/a.md', status: 'modified' },
        { path: 'docs/b.md', status: 'modified' },
        { path: 'api/docs/auth.md', status: 'modified' },
      ],
      SITES,
      () => undefined,
    ).groups;
    expect(sendSummary(two, t)).toBe('Guia: atualiza A e B. API: atualiza Auth');
  });
});
