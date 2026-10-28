import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_SITES, BUILT_IN_TEMPLATES, templateLanguage } from './builtInTemplates';
import { lintFindings } from './lint';
import { buildSitePages, parseSiteTemplate, siteUsedFields } from './siteTemplates';
import { AUTOMATIC_FIELDS, fillTemplate, firstToFill, parseTemplate, usedFields } from './templates';

/** Valores de exemplo: os automáticos e um texto para cada campo do template. */
const SAMPLE_VALUES = { title: 'Página de exemplo', date: '2026-10-28', site_name: 'Wiki', owner: 'time-docs' };

describe('templates da extensão', () => {
  const dir = join(__dirname, '..', 'templates');

  it('todo arquivo de templates/ está no registro, nas duas línguas', () => {
    for (const language of ['en', 'pt-br'] as const) {
      const files = readdirSync(join(dir, language)).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort();
      expect(Object.keys(BUILT_IN_TEMPLATES[language]).sort()).toEqual(files);
    }
    expect(Object.keys(BUILT_IN_TEMPLATES.en)).toHaveLength(13);
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
      const sites = readdirSync(join(dir, language, 'sites')).sort();
      expect(Object.keys(BUILT_IN_SITES[language]).sort()).toEqual(sites);
      for (const id of sites) {
        expect(Object.keys(BUILT_IN_SITES[language][id]).sort(), `${language}/${id}`).toEqual(readdirSync(join(dir, language, 'sites', id)).sort());
      }
    }
    expect(Object.keys(BUILT_IN_SITES.en)).toHaveLength(3);
  });

  for (const language of ['en', 'pt-br'] as const) {
    for (const [id, files] of Object.entries(BUILT_IN_SITES[language])) {
      it(`site ${language}/${id}: páginas existem, só usam campos automáticos e passam no lint`, () => {
        const site = parseSiteTemplate(id, files['template.yml'])!;
        expect(site).toBeDefined();
        expect(site.description).not.toBe('');
        const sources = sitePageSources(language, files);
        const used = siteUsedFields(site, sources);
        // Os campos das páginas (ex.: status do ADR) teriam de ser declarados no site: hoje nenhum é usado
        expect(used.filter(f => !AUTOMATIC_FIELDS.includes(f))).toEqual([]);
        expect(Object.keys(files).filter(f => f !== 'template.yml' && !site.files.some(s => s.source === f))).toEqual([]);
        for (const page of buildSitePages(site, sources, SAMPLE_VALUES)) {
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
