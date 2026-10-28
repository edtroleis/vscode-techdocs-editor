import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_TEMPLATES, templateLanguage } from './builtInTemplates';
import { lintFindings } from './lint';
import { AUTOMATIC_FIELDS, fillTemplate, parseTemplate, usedFields } from './templates';

/** Valores de exemplo: os automáticos e um texto para cada campo do template. */
const SAMPLE_VALUES = { title: 'Página de exemplo', date: '2026-10-28', site_name: 'Wiki', owner: 'time-docs' };

describe('templates da extensão', () => {
  const dir = join(__dirname, '..', 'templates');

  it('todo arquivo de templates/ está no registro, nas duas línguas', () => {
    for (const language of ['en', 'pt-br'] as const) {
      const files = readdirSync(join(dir, language)).map(f => f.replace(/\.md$/, '')).sort();
      expect(Object.keys(BUILT_IN_TEMPLATES[language]).sort()).toEqual(files);
    }
    expect(Object.keys(BUILT_IN_TEMPLATES.en)).toHaveLength(13);
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

  it('língua pela do VS Code', () => {
    expect(templateLanguage('pt-br')).toBe('pt-br');
    expect(templateLanguage('pt')).toBe('pt-br');
    expect(templateLanguage('en-us')).toBe('en');
    expect(templateLanguage('de')).toBe('en');
  });
});
