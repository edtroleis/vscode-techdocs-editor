import { parseDocument } from 'yaml';
import { docsTree } from './docsTree';
import {
  adoptedMkdocsYml,
  buildSitePages,
  hasTechdocsRef,
  parseSiteTemplate,
  readableSiteName,
  readmeAsHome,
  siteMkdocsYml,
  siteUsedFields,
  techdocsRefAnnotation,
} from './siteTemplates';

const SITE = `version: 1
name: Docs de serviço
description: Um serviço do catálogo
fields:
  team:
    prompt: Time
    default: plataforma
  title:
    prompt: ignorado (automático)
mkdocs:
  site_name: ignorado
  markdown_extensions:
    - admonition
files:
  - path: index.md
    title: "{{site_name}}"
    page: service-home
  - path: adr/0001-registrar.md
    title: Registrar decisões
    section: Decisões
    source: adr-0001.md
  - path: arquitetura.md
    title: Arquitetura
    source: arquitetura.md
  - path: adr/0002-outra.md
    title: Outra
    section: Decisões
    source: adr-0001.md
  - path: ../fora.md
    title: Fora
    source: x.md
  - path: sem-titulo.md
    source: x.md
  - path: sem-origem.md
    title: Sem origem
  - path: c.md
    title: Fonte fora
    source: ../../segredo.md
`;

describe('parseSiteTemplate', () => {
  it('lê nome, campos, chaves do mkdocs.yml e os arquivos válidos', () => {
    const site = parseSiteTemplate('service-docs', SITE)!;
    expect(site).toMatchObject({ id: 'service-docs', name: 'Docs de serviço', description: 'Um serviço do catálogo', version: 1, nav: true });
    expect(site.fields).toEqual([{ name: 'team', prompt: 'Time', default: 'plataforma' }]);
    expect(site.files.map(f => f.path)).toEqual(['index.md', 'adr/0001-registrar.md', 'arquitetura.md', 'adr/0002-outra.md']);
    expect(site.files[0]).toEqual({ path: 'index.md', title: '{{site_name}}', page: 'service-home' });
    expect(site.files[1]).toEqual({ path: 'adr/0001-registrar.md', title: 'Registrar decisões', section: 'Decisões', source: 'adr-0001.md' });
  });

  it('não é template de site sem nome, sem arquivos ou com YAML quebrado', () => {
    expect(parseSiteTemplate('x', 'files:\n  - path: a.md\n    title: A\n    page: guide\n')).toBeUndefined();
    expect(parseSiteTemplate('x', 'name: X\nfiles: []\n')).toBeUndefined();
    expect(parseSiteTemplate('x', 'name: X\nfiles:\n  - path: ../a.md\n    title: A\n    page: guide\n')).toBeUndefined();
    expect(parseSiteTemplate('x', 'name: [\n')).toBeUndefined();
    expect(parseSiteTemplate('x', 'name: X\nnav: false\nfiles:\n  - path: a.md\n    title: A\n    page: guide\n')?.nav).toBe(false);
  });
});

describe('buildSitePages', () => {
  const site = parseSiteTemplate('service-docs', SITE)!;
  const sources = (file: { page?: string; source?: string }) =>
    file.page === 'service-home' ? '# {{title}}\n\nDono: {{owner}}.\n' : file.source === 'adr-0001.md' ? '# {{title}}\n\nData: {{date}}, {{team}}.\n' : file.source === 'arquitetura.md' ? '# {{title}}\n' : undefined;

  it('cada página com o próprio título em {{title}} e os campos do site', () => {
    const pages = buildSitePages(site, sources, { site_name: 'Pagamentos', owner: 'time-pag', date: '2026-10-28', team: 'pag' });
    expect(pages[0]).toEqual({ path: 'index.md', title: 'Pagamentos', content: '# Pagamentos\n\nDono: time-pag.\n' });
    expect(pages[1]).toEqual({ path: 'adr/0001-registrar.md', title: 'Registrar decisões', section: 'Decisões', content: '# Registrar decisões\n\nData: 2026-10-28, pag.\n' });
  });

  it('campos usados: títulos e textos, sem repetir', () => {
    expect(siteUsedFields(site, sources)).toEqual(['site_name', 'title', 'owner', 'date', 'team']);
  });

  it('arquivo que não existe vira erro com o nome', () => {
    expect(() => buildSitePages(site, file => (file.page ? undefined : '# x\n'), {})).toThrow('page template "service-home"');
  });
});

describe('siteMkdocsYml', () => {
  const site = parseSiteTemplate('service-docs', SITE)!;
  const pages = site.files.map(f => ({ path: f.path, title: f.title === '{{site_name}}' ? 'Pagamentos' : f.title, section: f.section, content: '' }));

  it('site_name, nav com as seções juntas, techdocs-core e as chaves do template', () => {
    const yml = siteMkdocsYml('Pagamentos: API', pages, site);
    expect(parseDocument(yml).toJSON()).toEqual({
      site_name: 'Pagamentos: API',
      nav: [
        { Pagamentos: 'index.md' },
        { Decisões: [{ 'Registrar decisões': 'adr/0001-registrar.md' }, { Outra: 'adr/0002-outra.md' }] },
        { Arquitetura: 'arquitetura.md' },
      ],
      plugins: ['techdocs-core'],
      markdown_extensions: ['admonition'],
    });
    // A árvore "Documentação" lê o arquivo gerado
    const tree = docsTree(yml, ['index.md', 'adr/0001-registrar.md', 'adr/0002-outra.md', 'arquitetura.md'], () => undefined);
    expect(tree.nodes.map(n => n.title)).toEqual(['Pagamentos', 'Decisões', 'Arquitetura']);
    expect(tree.notInNav).toEqual([]);
  });

  it('sem nav, e o techdocs-core não é repetido', () => {
    const yml = siteMkdocsYml('X', pages, { nav: false, mkdocs: { plugins: ['search', { 'techdocs-core': { use_material_search: true } }] } });
    expect(parseDocument(yml).toJSON()).toEqual({ site_name: 'X', plugins: ['search', { 'techdocs-core': { use_material_search: true } }] });
    expect(parseDocument(siteMkdocsYml('X', pages, { nav: false, mkdocs: { plugins: ['search'] } })).toJSON().plugins).toEqual(['techdocs-core', 'search']);
  });
});

describe('catalog-info.yaml', () => {
  it('anotação relativa à pasta do catalog-info.yaml', () => {
    expect(techdocsRefAnnotation('', '')).toBe('backstage.io/techdocs-ref: dir:.');
    expect(techdocsRefAnnotation('svc', 'svc/')).toBe('backstage.io/techdocs-ref: dir:.');
    expect(techdocsRefAnnotation('', 'svc/docs-site')).toBe('backstage.io/techdocs-ref: dir:./svc/docs-site');
    expect(techdocsRefAnnotation('svc', '')).toBe('backstage.io/techdocs-ref: dir:..');
    expect(techdocsRefAnnotation('a/b', 'a/c')).toBe('backstage.io/techdocs-ref: dir:../c');
  });

  it('anotação já presente, em qualquer documento', () => {
    const component = 'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: x\n';
    expect(hasTechdocsRef(component)).toBe(false);
    expect(hasTechdocsRef(`${component}  annotations:\n    github.com/project-slug: a/b\n`)).toBe(false);
    expect(hasTechdocsRef(`kind: System\n---\n${component}  annotations:\n    backstage.io/techdocs-ref: dir:.\n`)).toBe(true);
  });
});

describe('adoptedMkdocsYml', () => {
  it('nav pelas pastas: index primeiro, títulos do título 1, pastas viram seções; e o techdocs-core', () => {
    const titles: Record<string, string> = { 'index.md': 'Pagamentos', 'guias/deploy.md': 'Deploy', 'arquitetura.md': 'Arquitetura' };
    const yml = adoptedMkdocsYml('Pagamentos', ['guias/rollback.md', 'arquitetura.md', 'guias/deploy.md', 'index.md'], p => titles[p]);
    expect(yml).toBe(
      [
        'site_name: Pagamentos',
        'nav:',
        '  - Pagamentos: index.md',
        '  - Arquitetura: arquitetura.md',
        '  - Guias:',
        '      - Deploy: guias/deploy.md',
        '      - Rollback: guias/rollback.md',
        'plugins:',
        '  - techdocs-core',
        '',
      ].join('\n'),
    );
    // O MkDocs monta o menu do jeito que a árvore mostra
    expect(docsTree(yml, ['index.md', 'arquitetura.md', 'guias/deploy.md', 'guias/rollback.md']).notInNav).toEqual([]);
  });

  it('sem título 1, o nome do arquivo; README.md conta como página inicial', () => {
    const yml = adoptedMkdocsYml('X', ['README.md', 'como-usar.md'], () => undefined);
    expect(parseDocument(yml).toJS().nav).toEqual([{ Home: 'README.md' }, { 'Como usar': 'como-usar.md' }]);
  });
});

describe('readableSiteName', () => {
  it('nome de repositório ou de pasta vira palavras; título de verdade fica', () => {
    expect(readableSiteName('techdocs-cenario-vazio')).toBe('Techdocs cenario vazio');
    expect(readableSiteName('api_core')).toBe('Api core');
    expect(readableSiteName('payments')).toBe('Payments');
    expect(readableSiteName('Serviço de Pagamentos')).toBe('Serviço de Pagamentos');
    expect(readableSiteName('PaymentsAPI')).toBe('PaymentsAPI');
    expect(readableSiteName('2026')).toBe('2026');
  });
});

describe('readmeAsHome', () => {
  it('links e imagens para docs/ ficam relativos à pasta; o resto fica como está', () => {
    const readme = [
      '# Pagamentos',
      '',
      'Veja o [deploy](docs/guias/deploy.md) e ![arquitetura](./docs/assets/a.png).',
      'Código em [src](src/main.ts), regras em [CONTRIBUTING](CONTRIBUTING.md) e [site](https://docs.x).',
      '',
      '[ref]: docs/ref.md',
    ].join('\n');
    expect(readmeAsHome(readme)).toBe(
      [
        '# Pagamentos',
        '',
        'Veja o [deploy](guias/deploy.md) e ![arquitetura](assets/a.png).',
        'Código em [src](src/main.ts), regras em [CONTRIBUTING](CONTRIBUTING.md) e [site](https://docs.x).',
        '',
        '[ref]: ref.md',
      ].join('\n'),
    );
  });
});
