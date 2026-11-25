/** Tipos de página no editor visual: o botão próprio na barra e o grupo no "/"; o texto vem da extensão. */
import { expect, test } from '@playwright/test';
import { slash } from './editing';
import { fromHost, openWebview, savedText, sent } from './webview';

const PAGE_KINDS = {
  group: 'Kinds of page',
  kinds: [
    { id: 'runbook', label: 'Runbook', description: 'Answer an alert' },
    { id: 'tutorial', label: 'Tutorial', description: 'Teach step by step' },
  ],
};
const RUNBOOK = { type: 'pageKind', markdown: '## When it fires\n\nDescribe the alert.\n', select: 'Describe the alert.' };

test('botão Kinds of page na barra: só os tipos de página; o escolhido entra na página', async ({ page }) => {
  await openWebview(page, '# Configuração\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  await page.locator('.top-bar-item[title="Kinds of page"]').click();
  const menu = page.getByRole('menu', { name: 'Kinds of page' });
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('Runbook');
  await expect(items.first()).toContainText('Answer an alert');
  await items.first().click();
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'pageKind' && (m as { id?: string }).id === 'runbook')).toBe(true);
  await fromHost(page, RUNBOOK);
  await expect.poll(() => savedText(page)).toBe('# Configuração\n\n## When it fires\n\nDescribe the alert.\n');
});

test('o botão TechDocs fica só com os componentes, mesmo com tipos de página', async ({ page }) => {
  await openWebview(page, '# Configuração\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  await page.locator('.top-bar-item[title="TechDocs"]').click();
  const menu = page.getByRole('menu', { name: 'TechDocs' });
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.getByText('Runbook')).toHaveCount(0);
  await expect(menu.getByText('Kinds of page')).toHaveCount(0);
});

test('"/": os tipos de página também estão no menu de blocos', async ({ page }) => {
  await openWebview(page, '# Configuração\n\nTexto.\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  await page.getByText('Texto.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await slash(page, 'Tutorial');
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'pageKind' && (m as { id?: string }).id === 'tutorial')).toBe(true);
});

test('sem tipos de página, não há o botão deles e os outros botões têm o nome certo', async ({ page }) => {
  await openWebview(page, '# Configuração\n', 'en');
  await expect(page.locator('.top-bar-item[title="TechDocs"]')).toHaveCount(1);
  await expect(page.locator('.top-bar-item[title="Kinds of page"]')).toHaveCount(0);
  await expect(page.locator('.top-bar-item[title="Insert"]')).toHaveCount(1);
});

test('janela baixa: o menu cabe na tela e rola até o último item', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 300 });
  await openWebview(page, '# Configuração\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  await page.locator('.top-bar-item[title="TechDocs"]').click();
  const menu = page.getByRole('menu', { name: 'TechDocs' });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(300);
  // O último item: rola até ele e ele fica visível dentro do menu
  const last = menu.getByRole('menuitem').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});
