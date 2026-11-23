import { expect, test } from '@playwright/test';
import { BUILT_IN_EXAMPLES, BUILT_IN_SITES, BUILT_IN_TEMPLATES } from '../../../core/src/builtInTemplates';
import { buildSitePages, parseSiteTemplate } from '../../../core/src/siteTemplates';
import { fillTemplate, parseTemplate } from '../../../core/src/templates';
import { openWebview, savedText, sent } from './webview';

/**
 * Templates da extensão (spec 04): a página criada de cada um abre no editor visual sem gerar edição, e
 * a ida e volta é byte a byte igual. Com valores de exemplo nos campos, como na criação. Também as páginas
 * dos templates de site (TP11), montadas como na criação.
 */
const SAMPLE = { title: 'Página de exemplo', date: '2026-10-28', site_name: 'Wiki', owner: 'time-docs' };

for (const language of ['en', 'pt-br'] as const) {
  for (const [id, text] of Object.entries(BUILT_IN_TEMPLATES[language])) {
    const file = `${id}.md`;
    const template = parseTemplate(id, text)!;
    const values = { ...SAMPLE, ...Object.fromEntries(template.fields.map(f => [f.name, f.default || 'Valor'])) };
    roundtrip(`template ${language}/${file}`, fillTemplate(template.body, values), language);
  }
  // As páginas de exemplo (spec 08): quem copia uma delas para o seu site a edita no visual sem mudanças
  for (const [path, text] of Object.entries(BUILT_IN_EXAMPLES[language])) roundtrip(`exemplo ${language}/${path}`, text, language);
  for (const [id, files] of Object.entries(BUILT_IN_SITES[language])) {
    const site = parseSiteTemplate(id, files['template.yml'])!;
    const sources = (f: { page?: string; source?: string }) =>
      f.page ? parseTemplate(f.page, BUILT_IN_TEMPLATES[language][f.page])!.body : files[f.source!];
    for (const sitePage of buildSitePages(site, sources, SAMPLE)) {
      // Páginas que vêm de um template de página já são testadas acima
      if (site.files.find(f => f.path === sitePage.path)?.source) roundtrip(`site ${language}/${id}/${sitePage.path}`, sitePage.content, language);
    }
  }
}

function roundtrip(name: string, text: string, language: string) {
  test(`${name}: ida e volta idêntica`, async ({ page }) => {
    const { errors } = await openWebview(page, text, language);
    expect(await savedText(page)).toBe(text);
    await page.waitForTimeout(300);
    expect((await sent(page)).filter(m => m.type === 'edit')).toEqual([]);
    expect(errors).toEqual([]);
  });
}
