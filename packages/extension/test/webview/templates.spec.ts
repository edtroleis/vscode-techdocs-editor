import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSitePages, parseSiteTemplate } from '../../../core/src/siteTemplates';
import { fillTemplate, parseTemplate } from '../../../core/src/templates';
import { openWebview, savedText, sent } from './webview';

/**
 * Templates da extensão (spec 04): a página criada de cada um abre no editor visual sem gerar edição, e
 * a ida e volta é byte a byte igual. Com valores de exemplo nos campos, como na criação. Também as páginas
 * dos templates de site (TP11), montadas como na criação.
 */
const DIR = join(__dirname, '..', '..', '..', 'core', 'templates');
const SAMPLE = { title: 'Página de exemplo', date: '2026-10-28', site_name: 'Wiki', owner: 'time-docs' };

for (const language of ['en', 'pt-br']) {
  for (const file of readdirSync(join(DIR, language)).filter(f => f.endsWith('.md'))) {
    const template = parseTemplate(file.replace(/\.md$/, ''), readFileSync(join(DIR, language, file), 'utf8'))!;
    const values = { ...SAMPLE, ...Object.fromEntries(template.fields.map(f => [f.name, f.default || 'Valor'])) };
    roundtrip(`template ${language}/${file}`, fillTemplate(template.body, values), language);
  }
  for (const id of readdirSync(join(DIR, language, 'sites'))) {
    const folder = join(DIR, language, 'sites', id);
    const site = parseSiteTemplate(id, readFileSync(join(folder, 'template.yml'), 'utf8'))!;
    const sources = (f: { page?: string; source?: string }) =>
      f.page ? parseTemplate(f.page, readFileSync(join(DIR, language, `${f.page}.md`), 'utf8'))!.body : readFileSync(join(folder, f.source!), 'utf8');
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
