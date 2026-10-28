import { catalogOwner, fileNameFor, fillTemplate, mergeTemplates, nextNumber, pagePath, parseTemplate, usedFields } from './templates';

const RUNBOOK = `---
template:
  version: 1
  name: Runbook
  description: Responder a um alerta
  category: guide
  folder: runbooks/
  fields:
    alert:
      prompt: Nome do alerta
      default: HighLatency
tags:
  - operação
---

# {{title}}

**Alerta:** {{alert}} · **Dono:** {{owner}} · {{ nada }} {{sem fim
`;

describe('parseTemplate', () => {
  it('lê o bloco template e tira ele da página, mantendo o resto do front matter', () => {
    const template = parseTemplate('runbook', RUNBOOK)!;
    expect(template).toMatchObject({
      id: 'runbook',
      name: 'Runbook',
      category: 'guide',
      folder: 'runbooks',
      numbered: false,
      version: 1,
      fields: [{ name: 'alert', prompt: 'Nome do alerta', default: 'HighLatency' }],
    });
    expect(template.body).toBe('---\ntags:\n  - operação\n---\n\n# {{title}}\n\n**Alerta:** {{alert}} · **Dono:** {{owner}} · {{ nada }} {{sem fim\n');
  });

  it('sem outro front matter, a página começa no título', () => {
    const template = parseTemplate('x', '---\ntemplate:\n  name: X\n---\n\n# {{title}}\n')!;
    expect(template.body).toBe('# {{title}}\n');
    expect(template.category).toBe('reference');
  });

  it('arquivo sem o bloco template não é template', () => {
    expect(parseTemplate('readme', '# Como usar os templates\n')).toBeUndefined();
    expect(parseTemplate('pagina', '---\ntitle: Página\n---\n\n# Página\n')).toBeUndefined();
    expect(parseTemplate('quebrado', '---\ntemplate: [\n---\n# X\n')).toBeUndefined();
  });
});

describe('campos', () => {
  it('preenche, campo sem valor vira vazio e {{ sem }} fica', () => {
    const body = parseTemplate('runbook', RUNBOOK)!.body;
    expect(fillTemplate(body, { title: 'Latência alta', alert: 'HighLatency', owner: 'time-a' })).toContain(
      '# Latência alta\n\n**Alerta:** HighLatency · **Dono:** time-a ·  {{sem fim',
    );
    expect(usedFields(body)).toEqual(['title', 'alert', 'owner', 'nada']);
  });

  it('owner do catalog-info.yaml', () => {
    expect(catalogOwner('apiVersion: backstage.io/v1alpha1\nkind: Component\nspec:\n  owner: group:time-a\n')).toBe('group:time-a');
    expect(catalogOwner('---\nkind: Location\n---\nkind: Component\nspec:\n  owner: time-b\n')).toBe('time-b');
    expect(catalogOwner('kind: Component\n')).toBeUndefined();
  });
});

describe('arquivo da página', () => {
  it.each([
    ['Guia de deploy', 'guia-de-deploy.md'],
    ['Usar PostgreSQL em vez de MySQL!', 'usar-postgresql-em-vez-de-mysql.md'],
    ['Ação & Reação', 'acao-reacao.md'],
    ['???', 'pagina.md'],
  ])('%s → %s', (title, name) => {
    expect(fileNameFor(title)).toBe(name);
  });

  it('número do próximo ADR', () => {
    expect(nextNumber([])).toBe('0001');
    expect(nextNumber(['0001-registrar-decisoes.md', '0007-usar-postgres.md', 'index.md'])).toBe('0008');
  });

  it('nunca sai do docs_dir (TP4)', () => {
    expect(pagePath('runbooks', 'latencia.md')).toBe('runbooks/latencia.md');
    expect(pagePath('', 'guias/deploy.md')).toBe('guias/deploy.md');
    expect(pagePath('../fora', 'x.md')).toBeUndefined();
    expect(pagePath('', '../x.md')).toBeUndefined();
    expect(pagePath('', '/etc/x.md')).toBeUndefined();
    expect(pagePath('', 'C:\\x.md')).toBeUndefined();
    expect(pagePath('', 'sem-extensao')).toBeUndefined();
  });
});

describe('mergeTemplates', () => {
  const t = (id: string, category: 'guide' | 'tutorial', name = id) => ({ template: parseTemplate(id, `---\ntemplate:\n  name: ${name}\n  category: ${category}\n---\n# x\n`)! });

  it('os do repositório primeiro, sobrepondo os da extensão pelo id; por categoria e nome', () => {
    const merged = mergeTemplates([t('runbook', 'guide', 'Runbook da empresa')], [t('runbook', 'guide'), t('guide', 'guide', 'Guia'), t('tutorial', 'tutorial', 'Tutorial')]);
    expect(merged.map(m => m.template.name)).toEqual(['Runbook da empresa', 'Tutorial', 'Guia']);
  });
});
