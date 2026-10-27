/**
 * Problemas de formatação no editor visual (spec 01, L-3, L-4 e W12): o host manda a lista; o webview
 * mostra a lista e as marcas, e pede "Ver linha" e "Ajustar agora".
 */
import { expect, test } from '@playwright/test';
import { fromHost, openWebview, sent } from './webview';

const PAGE = '# Página\n\nPrimeiro parágrafo.\n\n```\ncódigo\n```\n\nÚltimo parágrafo.   \n';
const PROBLEMS = [
  { line: 5, message: 'There is a code block without a language', fixable: false },
  { line: 9, message: 'There are extra spaces at the end of the line', fixable: true },
];

const panel = (page: import('@playwright/test').Page) => page.locator('.problems');

test('sem problemas, sem lista', async ({ page }) => {
  await openWebview(page, PAGE);
  await fromHost(page, { type: 'lint', problems: [] });
  await expect(panel(page)).toHaveCount(0);
});

test('lista com o total, a linha e o texto de cada problema', async ({ page }) => {
  await openWebview(page, PAGE);
  await fromHost(page, { type: 'lint', problems: PROBLEMS });
  await expect(panel(page).locator('summary')).toHaveText('2 formatting problems');
  await expect(panel(page).locator('li')).toHaveText([
    'Line 5 There is a code block without a language',
    'Line 9 There are extra spaces at the end of the line',
  ]);
  await fromHost(page, { type: 'lint', problems: PROBLEMS.slice(0, 1) });
  await expect(panel(page).locator('summary')).toHaveText('1 formatting problem');
});

test('marca nos blocos com problema, com o problema na dica', async ({ page }) => {
  await openWebview(page, PAGE);
  await fromHost(page, { type: 'lint', problems: PROBLEMS });
  const marks = page.locator('.docs-editor-problem');
  await expect(marks).toHaveText(['● 5', '● 9']);
  await expect(marks.first()).toHaveAttribute('title', /There is a code block without a language\nShow line 5/);
});

test('"Ver linha" pelo número ao lado do bloco, pelo teclado e pela lista', async ({ page }) => {
  await openWebview(page, PAGE);
  await fromHost(page, { type: 'lint', problems: PROBLEMS });
  await page.locator('.docs-editor-line', { hasText: /^3$/ }).click();
  await page.locator('.docs-editor-line', { hasText: /^1$/ }).focus();
  await page.keyboard.press('Enter');
  await panel(page).getByRole('button', { name: 'Line 9' }).click();
  await expect.poll(async () => (await sent(page)).filter(m => m.type === 'showLine').map(m => m.line)).toEqual([3, 1, 9]);
});

test('"Ajustar agora" só aparece com problema corrigível e pede a correção ao host', async ({ page }) => {
  await openWebview(page, PAGE);
  await fromHost(page, { type: 'lint', problems: PROBLEMS.slice(0, 1) });
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Fix automatically' })).toHaveCount(0);
  await fromHost(page, { type: 'lint', problems: PROBLEMS });
  await panel(page).getByRole('button', { name: 'Fix automatically' }).click();
  await expect.poll(async () => (await sent(page)).filter(m => m.type === 'fixLint').length).toBe(1);
});
