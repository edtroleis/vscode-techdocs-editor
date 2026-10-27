/**
 * Busca no editor visual (spec 01, W10): Ctrl+F abre a barra, "N de M", Enter/Shift+Enter andam pelos
 * resultados, Esc fecha e limpa o destaque.
 */
import { expect, Page, test } from '@playwright/test';
import { fromHost, lastEdit, openWebview } from './webview';

const PAGE = '# Página\n\nUm gato, dois gatos.\n\nO GATO dorme.\n';

const bar = (page: Page) => page.locator('.docs-search-bar');
const count = (page: Page) => bar(page).locator('.docs-search-count');

async function openSearch(page: Page) {
  await page.locator('.milkdown .ProseMirror p').first().click();
  await page.keyboard.press('Control+F');
  await expect(bar(page).locator('input')).toBeFocused();
}

test('Ctrl+F abre a barra; "N de M", sem diferenciar maiúsculas', async ({ page }) => {
  await openWebview(page, PAGE);
  await expect(bar(page)).toHaveCount(0);
  await openSearch(page);
  await page.keyboard.type('gato');
  await expect(count(page)).toHaveText('1 de 3');
  await expect(page.locator('.docs-search-current')).toHaveCount(1);
  await expect(page.locator('.docs-search-match')).toHaveCount(2);
  await expect(page.locator('.docs-search-current')).toHaveText('gato');
});

test('Enter vai para o próximo, Shift+Enter para o anterior, dando a volta', async ({ page }) => {
  await openWebview(page, PAGE);
  await openSearch(page);
  await page.keyboard.type('gato');
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('2 de 3');
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('3 de 3');
  await expect(page.locator('.docs-search-current')).toHaveText('GATO');
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('1 de 3');
  await page.keyboard.press('Shift+Enter');
  await expect(count(page)).toHaveText('3 de 3');
  await bar(page).getByRole('button', { name: 'Anterior (Shift+Enter)' }).click();
  await expect(count(page)).toHaveText('2 de 3');
  await bar(page).getByRole('button', { name: 'Próximo (Enter)' }).click();
  await expect(count(page)).toHaveText('3 de 3');
});

test('sem resultado; a busca não muda o documento', async ({ page }) => {
  await openWebview(page, PAGE);
  await openSearch(page);
  await page.keyboard.type('cachorro');
  await expect(count(page)).toHaveText('nenhum resultado');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(await lastEdit(page)).toBeUndefined();
});

test('Esc fecha, limpa o destaque e volta o foco ao texto', async ({ page }) => {
  await openWebview(page, PAGE);
  await openSearch(page);
  await page.keyboard.type('gato');
  await expect(count(page)).toHaveText('1 de 3');
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.docs-search-match, .docs-search-current')).toHaveCount(0);
  await expect(page.locator('.milkdown .ProseMirror')).toBeFocused();
});

test('com uma palavra selecionada, Ctrl+F já procura por ela; de novo, volta ao campo', async ({ page }) => {
  await openWebview(page, PAGE);
  await page.locator('.milkdown .ProseMirror p').nth(1).dblclick({ position: { x: 4, y: 8 } });
  await page.keyboard.press('Control+F');
  await expect(bar(page).locator('input')).toHaveValue('O');
  await page.keyboard.type('gato');
  await expect(count(page)).toHaveText('1 de 3');
  await page.locator('.milkdown .ProseMirror p').first().click();
  await page.keyboard.press('Control+F');
  await expect(bar(page).locator('input')).toBeFocused();
  await expect(bar(page).locator('input')).toHaveValue('gato');
});

test('o total acompanha mudanças no texto (de fora e da pessoa)', async ({ page }) => {
  await openWebview(page, PAGE);
  await openSearch(page);
  await page.keyboard.type('gato');
  await expect(count(page)).toHaveText('1 de 3');
  await fromHost(page, { type: 'update', text: `${PAGE}\nMais um gato.\n` });
  await expect(count(page)).toHaveText('1 de 4');
  await page.locator('.milkdown .ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' E outro gato.');
  await expect(count(page)).toHaveText('1 de 5');
});
