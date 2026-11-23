import { BUILT_IN_EXAMPLES, BUILT_IN_SITES, BUILT_IN_TEMPLATES, TEMPLATES_SOURCE, templateLanguage } from './builtInTemplates';
import { TEMPLATES_FILES } from './templatesBundle.generated';
import { lintFindings } from './lint';
import { buildSitePages, parseSiteTemplate, siteUsedFields } from './siteTemplates';
import { AUTOMATIC_FIELDS, fileNameFor, fillTemplate, firstToFill, parseTemplate, usedFields } from './templates';

/** Valores de exemplo: os automáticos e um texto para cada campo do template. */
const SAMPLE_VALUES = { title: 'Página de exemplo', date: '2026-10-28', site_name: 'Wiki', owner: 'time-docs' };

describe('templates da extensão', () => {
  /** Os caminhos da cópia do repositório de templates que começam com `prefix`, sem ele. */
  const paths = (prefix: string) => Object.keys(TEMPLATES_FILES).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length));

  it('a cópia vem de uma tag do repositório de templates (spec 08, TR3)', () => {
    expect(TEMPLATES_SOURCE.repository).toBe('https://github.com/edtroleis/techdocs-templates');
    expect(TEMPLATES_SOURCE.ref).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(TEMPLATES_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('toda página de templates/<língua>/<categoria>/ está no registro, nas duas línguas', () => {
    for (const language of ['en', 'pt-br'] as const) {
      const files = paths(`templates/${language}/`)
        .filter(p => !p.startsWith('sites/') && p.endsWith('.md'))
        .map(p => p.split('/').pop()!.replace(/\.md$/, ''))
        .sort();
      expect(Object.keys(BUILT_IN_TEMPLATES[language]).sort()).toEqual(files);
    }
    expect(Object.keys(BUILT_IN_TEMPLATES.en)).toHaveLength(17);
  });

  it('todo template aponta para um exemplo que existe na mesma língua (spec 08)', () => {
    for (const language of ['en', 'pt-br'] as const) {
      for (const [id, text] of Object.entries(BUILT_IN_TEMPLATES[language])) {
        const example = parseTemplate(id, text)!.example;
        expect(example, `${language}/${id}`).toBeTruthy();
        expect(BUILT_IN_EXAMPLES[language][example!], `${language}/${example}`).toBeDefined();
      }
    }
  });

  it('toda página criada tem um primeiro trecho a preencher (TP7)', () => {
    for (const language of ['en', 'pt-br'] as const) {
      for (const [id, text] of Object.entries(BUILT_IN_TEMPLATES[language])) {
        const page = fillTemplate(parseTemplate(id, text)!.body, SAMPLE_VALUES);
        expect(firstToFill(page), `${language}/${id}`).toBeTruthy();
      }
    }
  });

  for (const language of ['en', 'pt-br'] as const) {
    for (const [id, source] of Object.entries(BUILT_IN_TEMPLATES[language])) {
      it(`${language}/${id}: é template, só usa campos declarados e passa no lint`, () => {
        const template = parseTemplate(id, source)!;
        expect(template).toBeDefined();
        expect(template.description).not.toBe('');
        const declared = [...AUTOMATIC_FIELDS, ...template.fields.map(f => f.name)];
        expect(usedFields(template.body).filter(f => !declared.includes(f))).toEqual([]);
        const values = { ...SAMPLE_VALUES, ...Object.fromEntries(template.fields.map(f => [f.name, f.default || 'Valor'])) };
        expect(lintFindings(fillTemplate(template.body, values), { default: true }).map(f => `${f.rule} linha ${f.line}`)).toEqual([]);
      });
    }
  }

  it('as duas línguas têm os mesmos campos, categoria e pasta', () => {
    for (const [id, source] of Object.entries(BUILT_IN_TEMPLATES.en)) {
      const en = parseTemplate(id, source)!;
      const pt = parseTemplate(id, BUILT_IN_TEMPLATES['pt-br'][id])!;
      expect({ c: pt.category, f: pt.folder, n: pt.numbered, fields: pt.fields.map(f => f.name) }).toEqual({
        c: en.category,
        f: en.folder,
        n: en.numbered,
        fields: en.fields.map(f => f.name),
      });
    }
  });

  it('todo arquivo de templates/<língua>/sites/ está no registro', () => {
    for (const language of ['en', 'pt-br'] as const) {
      const files = paths(`templates/${language}/sites/`);
      const sites = [...new Set(files.map(p => p.split('/')[0]))].sort();
      expect(Object.keys(BUILT_IN_SITES[language]).sort()).toEqual(sites);
      for (const id of sites) {
        expect(Object.keys(BUILT_IN_SITES[language][id]).sort(), `${language}/${id}`).toEqual(files.filter(p => p.startsWith(`${id}/`)).map(p => p.slice(id.length + 1)).sort());
      }
    }
    expect(Object.keys(BUILT_IN_SITES.en)).toHaveLength(9);
    // O em branco é o primeiro (o padrão)
    expect(Object.keys(BUILT_IN_SITES.en)[0]).toBe('blank');
    // Os outros pelo nome na língua (em português, Biblioteca antes de Docs de serviço)
    expect(Object.keys(BUILT_IN_SITES['pt-br'])).toEqual(['blank', 'api', 'library', 'service-docs', 'golden-path', 'platform', 'project', 'runbooks', 'team-wiki']);
    expect(Object.keys(BUILT_IN_SITES.en)).toEqual(['blank', 'api', 'golden-path', 'platform', 'library', 'runbooks', 'project', 'service-docs', 'team-wiki']);
  });

  for (const language of ['en', 'pt-br'] as const) {
    for (const [id, files] of Object.entries(BUILT_IN_SITES[language])) {
      it(`site ${language}/${id}: páginas existem, só usam campos automáticos e passam no lint`, () => {
        const site = parseSiteTemplate(id, files['template.yml'])!;
        expect(site).toBeDefined();
        expect(site.description).not.toBe('');
        const sources = sitePageSources(language, files);
        const used = siteUsedFields(site, sources);
        // Os campos das páginas (ex.: status do ADR) vêm declarados nelas: o painel usa o padrão, o comando pergunta
        const pageFields = site.files.flatMap(file =>
          file.page ? (parseTemplate(file.page, BUILT_IN_TEMPLATES[language][file.page] ?? '')?.fields ?? []) : [],
        );
        const declared = [...AUTOMATIC_FIELDS, ...site.fields.map(f => f.name), ...pageFields.map(f => f.name)];
        expect(used.filter(f => !declared.includes(f))).toEqual([]);
        expect(Object.keys(files).filter(f => f !== 'template.yml' && !site.files.some(s => s.source === f))).toEqual([]);
        const values = { ...Object.fromEntries(pageFields.map(f => [f.name, f.default ?? ''])), ...SAMPLE_VALUES };
        for (const page of buildSitePages(site, sources, values)) {
          expect(lintFindings(page.content, { default: true }).map(f => `${page.path}: ${f.rule} linha ${f.line}`)).toEqual([]);
          expect(page.content).not.toContain('{{');
        }
      });
    }
  }

  it('os sites nas duas línguas têm as mesmas páginas, seções e templates', () => {
    for (const [id, files] of Object.entries(BUILT_IN_SITES.en)) {
      const shape = (yml: string) => parseSiteTemplate(id, yml)!.files.map(f => ({ page: f.page, source: f.source, section: Boolean(f.section) }));
      expect(shape(BUILT_IN_SITES['pt-br'][id]['template.yml'])).toEqual(shape(files['template.yml']));
    }
  });

  it('sites em português: o nome do arquivo vem do título, não do inglês (ADR com o número na frente)', () => {
    for (const [id, files] of Object.entries(BUILT_IN_SITES['pt-br'])) {
      for (const file of parseSiteTemplate(id, files['template.yml'])!.files.filter(f => !f.path.endsWith('index.md'))) {
        expect(file.path.split('/').pop()!.replace(/^\d+-/, ''), `${id}/${file.path}`).toBe(fileNameFor(file.title));
      }
    }
  });

  it('língua pela do VS Code', () => {
    expect(templateLanguage('pt-br')).toBe('pt-br');
    expect(templateLanguage('pt')).toBe('pt-br');
    expect(templateLanguage('en-us')).toBe('en');
    expect(templateLanguage('de')).toBe('en');
  });
});

/** Texto de cada arquivo de um site da extensão: o template de página da mesma língua ou o arquivo do site. */
function sitePageSources(language: 'en' | 'pt-br', files: Record<string, string>) {
  return (file: { page?: string; source?: string }) =>
    file.page ? parseTemplate(file.page, BUILT_IN_TEMPLATES[language][file.page] ?? '')?.body : files[file.source!];
}
