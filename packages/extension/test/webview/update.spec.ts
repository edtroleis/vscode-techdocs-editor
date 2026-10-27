import { expect, test } from '@playwright/test';
import { cursorToEnd, editor } from './editing';
import { wikiPages } from './pages';
import { lastEdit, openWebview, savedText, sent } from './webview';

const post = (page: import('@playwright/test').Page, message: object) =>
  page.evaluate(m => window.postMessage(m, '*'), message);

/**
 * Mudança vinda do host (desfazer do VS Code, texto ao lado): o editor fica igual ao documento e
 * não devolve nada ao host (uma edição devolvida apagaria a pilha de refazer do VS Code).
 */
for (const { name, text } of wikiPages()) {
  test(`${name}: depois de uma mudança vinda do host, o editor grava o documento como está`, async ({ page }) => {
    await openWebview(page, text);
    await cursorToEnd(page, editor(page).locator('> p').first());
    await page.keyboard.type(' abc');
    await expect.poll(() => lastEdit(page)).toContain(' abc');
    const edits = (await sent(page)).filter(m => m.type === 'edit').length;
    await post(page, { type: 'update', text });
    expect(await savedText(page)).toBe(text);
    await page.waitForTimeout(600);
    expect((await sent(page)).filter(m => m.type === 'edit').length).toBe(edits);
  });
}

test('muitas mudanças seguidas vindas do host (alguém digitando no texto ao lado)', async ({ page }) => {
  const { text } = wikiPages().find(p => p.name.endsWith('wiki/docs/index.md'))!;
  await openWebview(page, text);
  const typed = '\nEscrito no texto.\n';
  for (let i = 1; i <= typed.length; i++) await post(page, { type: 'update', text: text + typed.slice(0, i) });
  await page.waitForTimeout(800);
  expect(await savedText(page)).toBe(`${text}\nEscrito no texto.\n`);
  expect((await sent(page)).filter(m => m.type === 'edit')).toEqual([]);
});
