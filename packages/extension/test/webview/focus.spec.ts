/**
 * O foco que o VS Code dá ao webview (Enter na árvore, Ctrl+1, voltar à aba) vai para o texto: sem isso o cursor
 * não aparece e o que a pessoa digita se perde. Um campo do webview que já tem o foco (a busca) fica com ele.
 */
import { expect, Page, test } from '@playwright/test';
import { lastEdit, openWebview } from './webview';

const PAGE = '# Página\n\nTexto.\n';
const text = (page: Page) => page.locator('.milkdown .ProseMirror');

/** Como o VS Code faz: o foco sai do webview e volta para a janela dele, sem nenhum campo focado. */
async function focusFromVsCode(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.dispatchEvent(new FocusEvent('focus'));
  });
}

test('ao abrir, o texto já tem o foco, com o cursor no começo, como no editor de texto', async ({ page }) => {
  await openWebview(page, PAGE);
  await expect(text(page)).toBeFocused();
  await page.keyboard.type('Começo. ');
  await expect.poll(() => lastEdit(page)).toContain('# Começo. Página');
});

test('o foco que chega antes de o editor ficar pronto vai para o texto quando ele fica pronto', async ({ page }) => {
  // No VS Code o webview pode receber o foco (Enter na árvore) enquanto o editor ainda monta, e document.hasFocus()
  // nem sempre diz que a janela tem o foco (no VS Code de teste, nunca)
  await page.addInitScript(() => (document.hasFocus = () => false));
  await openWebview(page, PAGE, 'pt-br', () => page.evaluate(() => window.dispatchEvent(new FocusEvent('focus'))));
  await expect(text(page)).toBeFocused();
});

test('o foco que saiu antes de o editor ficar pronto não volta para o texto', async ({ page }) => {
  await page.addInitScript(() => (document.hasFocus = () => false));
  await openWebview(page, PAGE, 'pt-br', () =>
    page.evaluate(() => {
      window.dispatchEvent(new FocusEvent('focus'));
      window.dispatchEvent(new FocusEvent('blur'));
    }),
  );
  await page.waitForTimeout(300);
  await expect(text(page)).not.toBeFocused();
});

test('o foco que volta ao webview vai para o texto', async ({ page }) => {
  await openWebview(page, PAGE);
  await focusFromVsCode(page);
  await expect(text(page)).toBeFocused();
});

test('com a busca aberta e focada, o foco fica na busca', async ({ page }) => {
  await openWebview(page, PAGE);
  await text(page).locator('p').click();
  await page.keyboard.press('Control+F');
  const search = page.locator('.docs-search-bar input');
  await expect(search).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
  await expect(search).toBeFocused();
});
