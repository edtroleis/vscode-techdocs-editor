/** Tipos de página no editor visual: o grupo no botão TechDocs da barra e no "/"; o texto vem da extensão. */
import { expect, test } from '@playwright/test';
import { slash } from './editing';
import { fromHost, openWebview, savedText, sent } from './webview';

const PAGE_KINDS = {
  group: 'Kinds of page',
  components: 'TechDocs components',
  kinds: [
    { id: 'runbook', label: 'Runbook', description: 'Answer an alert' },
    { id: 'tutorial', label: 'Tutorial', description: 'Teach step by step' },
  ],
};
const RUNBOOK = { type: 'pageKind', markdown: '## When it fires\n\nDescribe the alert.\n', select: 'Describe the alert.' };

test('botão TechDocs: os tipos de página primeiro, depois os componentes; o escolhido entra na página', async ({ page }) => {
  await openWebview(page, '# Configuração\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  await page.locator('.top-bar-item[title="TechDocs"]').click();
  const menu = page.getByRole('menu', { name: 'TechDocs' });
  await expect(menu.getByText('Kinds of page')).toBeVisible();
  await expect(menu.getByText('TechDocs components')).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items.first()).toContainText('Runbook');
  await expect(items.first()).toContainText('Answer an alert');
  await items.first().click();
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'pageKind' && (m as { id?: string }).id === 'runbook')).toBe(true);
  await fromHost(page, RUNBOOK);
  await expect.poll(() => savedText(page)).toBe('# Configuração\n\n## When it fires\n\nDescribe the alert.\n');
});

test('"/": os tipos de página também estão no menu de blocos', async ({ page }) => {
  await openWebview(page, '# Configuração\n\nTexto.\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  await page.getByText('Texto.').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await slash(page, 'Tutorial');
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'pageKind' && (m as { id?: string }).id === 'tutorial')).toBe(true);
});

test('sem tipos de página, o botão TechDocs mostra só os componentes', async ({ page }) => {
  await openWebview(page, '# Configuração\n', 'en');
  await page.locator('.top-bar-item[title="TechDocs"]').click();
  const menu = page.getByRole('menu', { name: 'TechDocs' });
  await expect(menu.getByRole('menuitem').first()).toBeVisible();
  await expect(menu.getByText('Kinds of page')).toHaveCount(0);
});

test('janela baixa: o menu do botão TechDocs cabe na tela e rola até o último item', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 400 });
  await openWebview(page, '# Configuração\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  await page.locator('.top-bar-item[title="TechDocs"]').click();
  const menu = page.getByRole('menu', { name: 'TechDocs' });
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(400);
  // O último item: rola até ele e ele fica visível dentro do menu
  const last = menu.getByRole('menuitem').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});
