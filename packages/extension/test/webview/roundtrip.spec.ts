import { expect, test } from '@playwright/test';
import { wikiPages } from './pages';
import { openWebview, savedText, sent } from './webview';

/**
 * Ida e volta com o editor de verdade (Crepe com os plugins da extensão, no bundle do webview):
 * abrir uma página das wikis não manda edição ao host, e o que o editor gravaria é o arquivo
 * byte a byte. Para outras pastas (ex.: as docs do PoC), `npm run roundtrip -- <pasta>`.
 */
for (const { name, text } of wikiPages()) {
  test(`${name}: abrir não gera edição e a ida e volta é idêntica`, async ({ page }) => {
    const { errors } = await openWebview(page, text);
    expect(await savedText(page)).toBe(text);
    await page.waitForTimeout(500);
    expect((await sent(page)).filter(m => m.type === 'edit')).toEqual([]);
    expect(errors).toEqual([]);
  });
}
