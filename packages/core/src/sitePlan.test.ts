import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { codeownersOwner, emptyEdits, moveNavEntry, newPagePath, newSectionPage, PlanInput, planSite } from './sitePlan';

const TEMPLATE = {
  nav: true,
  mkdocs: {},
  pages: [
    { path: 'index.md', title: 'Pagamentos', content: '# Pagamentos\n' },
    { path: 'architecture.md', title: 'Arquitetura', content: '# Arquitetura\n' },
    { path: 'adr/0001-registrar-decisoes.md', title: 'Registrar decisões', section: 'Decisões', content: '# Registrar decisões\n' },
  ],
};

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  siteName: 'Pagamentos',
  docsDir: 'docs',
  template: TEMPLATE,
  existing: [],
  catalog: { name: 'pagamentos', owner: 'time-pagamentos', annotation: 'backstage.io/techdocs-ref: dir:.' },
  pageTemplates: [{ id: 'adr', body: '# {{title}}\n\nStatus: {{status}}\n', fields: [{ name: 'status', prompt: 'Status', default: 'Proposto' }] }],
  values: { date: '2026-10-29', owner: 'time-pagamentos', site_name: 'Pagamentos' },
  edits: emptyEdits(),
  ...over,
});

const nav = (yml: string) => parse(yml).nav;
const file = (plan: ReturnType<typeof planSite>, path: string) => plan.files.find(f => f.path === path);

describe('planSite', () => {
  it('repositório vazio: mkdocs.yml, catalog-info.yaml e as páginas do template, todos novos', () => {
    const plan = planSite(input());
    expect(plan.files.map(f => [f.path, f.status])).toEqual([
      ['mkdocs.yml', 'new'],
      ['catalog-info.yaml', 'new'],
      ['docs/adr/0001-registrar-decisoes.md', 'new'],
      ['docs/architecture.md', 'new'],
      ['docs/index.md', 'new'],
    ]);
    expect(nav(file(plan, 'mkdocs.yml')!.content!)).toEqual([
      { Pagamentos: 'index.md' },
      { Arquitetura: 'architecture.md' },
      { Decisões: [{ 'Registrar decisões': 'adr/0001-registrar-decisoes.md' }] },
    ]);
    expect(file(plan, 'catalog-info.yaml')!.content).toContain('owner: time-pagamentos');
    expect(plan.missing).toEqual([]);
  });

  it('desmarcar uma página tira o arquivo e a entrada do menu; o mkdocs.yml não pode ser desmarcado', () => {
    const plan = planSite(input({ edits: { ...emptyEdits(), off: ['docs/architecture.md', 'mkdocs.yml'] } }));
    expect(file(plan, 'docs/architecture.md')!.included).toBe(false);
    expect(file(plan, 'mkdocs.yml')).toMatchObject({ included: true, optional: false });
    expect(nav(file(plan, 'mkdocs.yml')!.content!)).not.toContainEqual({ Arquitetura: 'architecture.md' });
  });

  it('reordenar e renomear mudam o menu; a seção renomeada continua com a mesma chave', () => {
    const first = planSite(input());
    const order = moveNavEntry(first.nav, 'section:Decisões', { before: 'index.md' });
    const plan = planSite(input({ edits: { ...emptyEdits(), order, titles: { 'architecture.md': 'Como funciona' }, sections: { Decisões: 'ADRs' } } }));
    expect(nav(file(plan, 'mkdocs.yml')!.content!)).toEqual([
      { ADRs: [{ 'Registrar decisões': 'adr/0001-registrar-decisoes.md' }] },
      { Pagamentos: 'index.md' },
      { 'Como funciona': 'architecture.md' },
    ]);
    expect(plan.nav[0]).toMatchObject({ kind: 'section', key: 'section:Decisões', name: 'ADRs' });
    expect(moveNavEntry(plan.nav, 'index.md', { delta: 1 })).toEqual(['section:Decisões', 'architecture.md', 'index.md']);
  });

  it('dono: obrigatório só com o catalog-info.yaml marcado; o nome do site, sempre', () => {
    const noOwner = input({ catalog: { name: 'x', owner: '', annotation: 'a' } });
    expect(planSite(noOwner).missing).toEqual(['owner']);
    expect(planSite({ ...noOwner, edits: { ...emptyEdits(), off: ['catalog-info.yaml'] } }).missing).toEqual([]);
    expect(planSite(input({ siteName: ' ' })).missing).toEqual(['siteName']);
  });

  it('README: copiado como página inicial (o README fica) ou movido (vira um link)', () => {
    const readme = { path: 'README.md', text: '# Pagamentos\n\nVer [guia](docs/guia.md).\n', pointer: 'A documentação está em docs/.' };
    const copy = planSite(input({ readme: { ...readme, use: 'copy' } }));
    expect(file(copy, 'docs/index.md')).toMatchObject({ readme: 'copy', content: '# Pagamentos\n\nVer [guia](guia.md).\n' });
    expect(file(copy, 'README.md')).toMatchObject({ status: 'unchanged', readme: 'copy' });
    const move = planSite(input({ readme: { ...readme, use: 'move' } }));
    expect(file(move, 'README.md')).toMatchObject({ status: 'modified', content: '# Pagamentos\n\nA documentação está em docs/.\n' });
    expect(file(planSite(input({ readme: { ...readme, use: 'skip' } })), 'README.md')).toBeUndefined();
  });

  it('página que já existe: manter (padrão) ou usar a do template', () => {
    const existing = [{ path: 'index.md', title: 'Início' }, { path: 'faq.md' }];
    const keep = planSite(input({ existing }));
    expect(file(keep, 'docs/index.md')).toMatchObject({ status: 'unchanged', conflict: { replace: false }, content: undefined });
    expect(file(keep, 'docs/faq.md')).toMatchObject({ status: 'unchanged', origin: 'existing' });
    expect(nav(file(keep, 'mkdocs.yml')!.content!)[0]).toEqual({ Início: 'index.md' });
    const replace = planSite(input({ existing, edits: { ...emptyEdits(), replace: ['index.md'] } }));
    expect(file(replace, 'docs/index.md')).toMatchObject({ status: 'modified', conflict: { replace: true }, content: '# Pagamentos\n' });
  });

  it('sem template: só as páginas que já existem, e o README como página inicial se não houver uma', () => {
    const plan = planSite(input({ template: undefined, existing: [{ path: 'deploy.md', title: 'Deploy' }], readme: { path: 'README.md', text: '# Wiki\n', use: 'copy', pointer: '' } }));
    expect(plan.files.filter(f => f.status === 'new').map(f => f.path)).toEqual(['mkdocs.yml', 'catalog-info.yaml', 'docs/index.md']);
    expect(nav(file(plan, 'mkdocs.yml')!.content!)).toEqual([{ Wiki: 'index.md' }, { Deploy: 'deploy.md' }]);
  });

  it('páginas que já existem numa subpasta ficam na seção com o nome dela', () => {
    const plan = planSite(input({ template: undefined, existing: [{ path: 'index.md', title: 'Início' }, { path: 'runbooks/rollback.md', title: 'Rollback' }] }));
    expect(nav(file(plan, 'mkdocs.yml')!.content!)).toEqual([{ Início: 'index.md' }, { Runbooks: [{ Rollback: 'runbooks/rollback.md' }] }]);
  });

  it('páginas acrescentadas: texto do template de página, com os padrões dos campos', () => {
    const plan = planSite(input({ edits: { ...emptyEdits(), added: [{ path: 'adr/0002-usar-postgres.md', title: 'Usar Postgres', section: 'Decisões', template: 'adr' }, { path: 'glossario.md', title: 'Glossário' }] } }));
    expect(file(plan, 'docs/adr/0002-usar-postgres.md')).toMatchObject({ origin: 'added', content: '# Usar Postgres\n\nStatus: Proposto\n' });
    expect(file(plan, 'docs/glossario.md')!.content).toBe('# Glossário\n');
    expect(nav(file(plan, 'mkdocs.yml')!.content!)).toContainEqual({
      Decisões: [{ 'Registrar decisões': 'adr/0001-registrar-decisoes.md' }, { 'Usar Postgres': 'adr/0002-usar-postgres.md' }],
    });
  });
});

describe('newPagePath', () => {
  const plan = planSite(input());

  it('pelo título (Menu): nome do arquivo sem acento; dentro da seção, na pasta dela', () => {
    expect(newPagePath('Glossário', { by: 'title' }, plan)).toEqual({ path: 'glossario.md', title: 'Glossário' });
    expect(newPagePath('Usar Postgres', { by: 'title', section: 'Decisões' }, plan)).toEqual({ path: 'adr/usar-postgres.md', title: 'Usar Postgres', section: 'Decisões' });
  });

  it('pelo caminho (Arquivos): o título sai do nome; a pasta de uma seção entra nela', () => {
    expect(newPagePath('guias/Como fazer deploy', { by: 'path' }, plan)).toEqual({ path: 'guias/como-fazer-deploy.md', title: 'Como fazer deploy', section: 'Guias' });
    expect(newPagePath('adr/outra.md', { by: 'path' }, plan)).toMatchObject({ path: 'adr/outra.md', section: 'Decisões' });
    // Um título na visão Arquivos: o caminho sai dele, e o título fica com acentos e maiúsculas
    expect(newPagePath('Referência da API', { by: 'path' }, plan)).toEqual({ path: 'referencia-da-api.md', title: 'Referência da API' });
    expect(newPagePath('../fora', { by: 'path' }, plan)).toBeUndefined();
    expect(newPagePath('  ', { by: 'title' }, plan)).toBeUndefined();
  });

  it('template numerado (ADR): pasta e número do template; nunca repete um caminho', () => {
    const adr = { id: 'adr', folder: 'adr', numbered: true };
    expect(newPagePath('Usar Postgres', { by: 'title', template: adr }, plan)).toEqual({ path: 'adr/0002-usar-postgres.md', title: 'Usar Postgres', section: 'Decisões', template: 'adr' });
    expect(newPagePath('Arquitetura', { by: 'title' }, plan)!.path).toBe('arquitetura.md');
    expect(newPagePath('architecture', { by: 'path' }, plan)!.path).toBe('architecture-2.md');
  });

  it('seção nova: pasta com index.md', () => {
    expect(newSectionPage('Referência', plan)).toEqual({ path: 'referencia/index.md', title: 'Referência', section: 'Referência' });
  });
});

describe('codeownersOwner', () => {
  it('o primeiro dono da última regra *, sem @ e sem a organização', () => {
    expect(codeownersOwner('# donos\n*.js @front\n* @acme/time-pagamentos @ana\n')).toBe('time-pagamentos');
    expect(codeownersOwner('* @ana\n* @bia\n')).toBe('bia');
    expect(codeownersOwner('docs/ @ana\n')).toBeUndefined();
  });
});
