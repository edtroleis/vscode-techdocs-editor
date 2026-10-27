/**
 * Busca no editor visual dentro do VS Code (spec 01, W10): o Ctrl+F chega ao editor visual (não a uma
 * busca do VS Code) e a barra conta os resultados.
 */
import { cursorAtEndOfFirstParagraph, expect, openVisual, test, visual } from './vscode';

const PAGE = 'wiki/docs/index.md';

test('Ctrl+F abre a busca do visual; Enter anda; Esc fecha', async ({ vscode: { page, file } }, testInfo) => {
  const total = (file(PAGE).match(/wiki/gi) ?? []).length;
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.press('Control+F');
  const bar = visual(page).locator('.docs-search-bar');
  await expect(bar.locator('input')).toBeFocused();
  // Nenhuma busca do VS Code abriu por cima
  await expect(page.locator('.find-widget.visible')).toHaveCount(0);

  await page.keyboard.type('wiki');
  await expect(bar.locator('.docs-search-count')).toHaveText(`1 of ${total}`);
  await page.keyboard.press('Enter');
  await expect(bar.locator('.docs-search-count')).toHaveText(`2 of ${total}`);
  await page.screenshot({ path: testInfo.outputPath('busca.png') });
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(visual(page).locator('.docs-search-current')).toHaveCount(0);
});
