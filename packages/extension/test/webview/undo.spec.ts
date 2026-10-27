import { expect, Page, test } from '@playwright/test';
import { cursorToEnd, editor } from './editing';
import { openWebview, sent } from './webview';

/**
 * No VS Code o histórico é um só, o do documento (spec 01, W4): os botões e atalhos de desfazer do
 * editor visual não usam o histórico do ProseMirror, mandam `undo`/`redo` ao host. O host executa o
 * comando do VS Code (e2e/history.spec.ts confere no VS Code de verdade).
 */
const ORIGINAL = '# Página\n\nTexto inicial.\n';
const UNDO = 13;
const REDO = 14;

const history = async (page: Page) =>
  (await sent(page)).filter(m => ['undo', 'redo'].includes(m.type)).map(m => m.type);

async function typeAtEnd(page: Page, text: string) {
  await cursorToEnd(page, editor(page).locator('p').first());
  await page.keyboard.type(text);
}

test('botões Desfazer e Refazer da barra mandam o comando ao host', async ({ page }) => {
  await openWebview(page, ORIGINAL);
  await typeAtEnd(page, 'abc');
  await page.locator('.top-bar-item').nth(UNDO).click();
  await page.locator('.top-bar-item').nth(REDO).click();
  await expect.poll(() => history(page)).toEqual(['undo', 'redo']);
  // O editor não desfez sozinho: quem desfaz é o documento, e o texto volta pelo host
  await expect(editor(page)).toContainText('Texto inicial.abc');
});

for (const [keys, expected] of [
  ['Control+Z', 'undo'],
  ['Control+Y', 'redo'],
  ['Control+Shift+Z', 'redo'],
] as const) {
  test(`${keys} manda ${expected} ao host, sem mexer no editor`, async ({ page }) => {
    await openWebview(page, ORIGINAL);
    await typeAtEnd(page, 'abc');
    await page.keyboard.press(keys);
    await expect.poll(() => history(page)).toEqual([expected]);
    await expect(editor(page)).toContainText('Texto inicial.abc');
  });
}

test('a edição chega ao host antes do desfazer', async ({ page }) => {
  await openWebview(page, ORIGINAL);
  await typeAtEnd(page, 'abc');
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => (await sent(page)).map(m => m.type).slice(-2)).toEqual(['edit', 'undo']);
  const edit = (await sent(page)).filter(m => m.type === 'edit').at(-1);
  expect(edit?.after).toBe('# Página\n\nTexto inicial.abc\n');
});
