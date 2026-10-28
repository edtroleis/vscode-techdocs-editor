import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fillTemplate, parseTemplate } from '../../../core/src/templates';
import { openWebview, savedText, sent } from './webview';

/**
 * Templates da extensão (spec 04): a página criada de cada um abre no editor visual sem gerar edição, e
 * a ida e volta é byte a byte igual. Com valores de exemplo nos campos, como na criação.
 */
const DIR = join(__dirname, '..', '..', '..', 'core', 'templates');
const SAMPLE = { title: 'Página de exemplo', date: '2026-10-28', site_name: 'Wiki', owner: 'time-docs' };

for (const language of ['en', 'pt-br']) {
  for (const file of readdirSync(join(DIR, language))) {
    const template = parseTemplate(file.replace(/\.md$/, ''), readFileSync(join(DIR, language, file), 'utf8'))!;
    const values = { ...SAMPLE, ...Object.fromEntries(template.fields.map(f => [f.name, f.default || 'Valor'])) };
    const text = fillTemplate(template.body, values);
    test(`template ${language}/${file}: ida e volta idêntica`, async ({ page }) => {
      const { errors } = await openWebview(page, text, language);
      expect(await savedText(page)).toBe(text);
      await page.waitForTimeout(300);
      expect((await sent(page)).filter(m => m.type === 'edit')).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
