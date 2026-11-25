/** Webview da janela Configurações do TechDocs (0.21): opções uma embaixo da outra, com rádio; grava na hora. */
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEND_CSS } from '../../src/send/sendCss';
import { SETTINGS_CSS } from '../../src/settingsCss';
import type { SettingsState } from '../../src/settingsView';
import { serveExtension } from './webview';

const LABELS = Object.fromEntries(
  [...readFileSync(join(__dirname, '..', '..', 'src', 'settingsView.ts'), 'utf8').matchAll(/(\w+): vscode\.l10n\.t\('([^']*)'\)/g)].map(m => [m[1], m[2]]),
);

const STATE: SettingsState = {
  sendTarget: 'pullRequest',
  cloneDirectory: '~/Documents/TechDocs',
  templates: { repository: 'acme/techdocs-templates', scope: 'team', teamPossible: true, builtIn: true },
  catalog: { mode: 'auto', scope: 'me', teamPossible: true },
  openVisual: true,
  syncExplorer: false,
};

type Sent = { type: string; [key: string]: unknown };
const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent);
const last = async (page: Page) => (await sent(page)).at(-1);
const show = (page: Page, state: SettingsState) => page.evaluate(message => window.postMessage(message, '*'), { type: 'state', state, labels: LABELS });

test.beforeEach(async ({ page }) => {
  await serveExtension(page);
  await page.goto('http://webview.test/test/webview/settings-harness.html');
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'ready')).toBe(true);
  // O mesmo estilo que a extensão põe na janela
  await page.addStyleTag({ content: SEND_CSS + SETTINGS_CSS });
  await show(page, STATE);
});

test('Enviar: as duas opções com rádio, uma embaixo da outra; escolher grava', async ({ page }) => {
  const review = page.getByRole('radio', { name: /^For review/ });
  const main = page.getByRole('radio', { name: /^Straight to the documentation/ });
  await expect(review).toBeChecked();
  await expect(main).not.toBeChecked();
  const [a, b] = [await review.boundingBox(), await main.boundingBox()];
  expect(b!.y, 'uma embaixo da outra').toBeGreaterThan(a!.y + 10);
  expect(Math.abs(b!.x - a!.x), 'na mesma coluna').toBeLessThan(2);
  await page.getByText('Straight to the documentation').click();
  expect(await last(page)).toEqual({ type: 'sendTarget', value: 'main' });
  await expect(page.getByText('Goes into the main branch right away', { exact: false })).toBeVisible();
});

test('catalog-info.yaml: três opções com rádio; escolher grava; Para o time / Só para mim', async ({ page }) => {
  await expect(page.getByRole('radio', { name: /^Check only if it exists/ })).toBeChecked();
  await page.getByRole('radio', { name: /^Require it/ }).check();
  expect(await last(page)).toEqual({ type: 'catalogMode', value: 'required' });
  const catalog = page.getByRole('group', { name: 'catalog-info.yaml' });
  await expect(catalog.getByRole('button', { name: 'Just for me' })).toHaveAttribute('aria-pressed', 'true');
  await catalog.getByRole('button', { name: 'For the team' }).click();
  expect(await last(page)).toEqual({ type: 'catalogScope', value: 'team' });
});

test('sem repositório (ou sem confiança): Para o time desligado', async ({ page }) => {
  await show(page, { ...STATE, catalog: { mode: 'off', scope: 'me', teamPossible: false } });
  await expect(page.getByRole('group', { name: 'catalog-info.yaml' }).getByRole('button', { name: 'For the team' })).toBeDisabled();
});

test('templates: repositório com Enter, Testar acesso com o resultado, os da extensão', async ({ page }) => {
  const box = page.getByRole('textbox', { name: 'Templates repository' });
  await expect(box).toHaveValue('acme/techdocs-templates');
  await box.fill('acme/outros');
  await box.press('Enter');
  expect(await last(page)).toEqual({ type: 'templatesRepository', value: 'acme/outros' });
  await page.getByRole('button', { name: 'Test access' }).click();
  expect(await last(page)).toEqual({ type: 'templatesTest' });
  await show(page, { ...STATE, templates: { ...STATE.templates!, test: { ok: true, text: '12 page templates and 2 site templates' } } });
  await expect(page.getByText('12 page templates and 2 site templates')).toBeVisible();
  await page.getByRole('checkbox', { name: /Show the extension templates/ }).uncheck();
  expect(await last(page)).toEqual({ type: 'templatesBuiltIn', value: false });
});

test('um estado novo não apaga o que a pessoa está digitando', async ({ page }) => {
  const box = page.getByRole('textbox', { name: 'Templates repository' });
  await box.fill('acme/meio-digit');
  await show(page, { ...STATE, sendTarget: 'main' });
  await expect(box).toHaveValue('acme/meio-digit');
  await expect(box).toBeFocused();
});

test('cópias do GitHub, editor e todas as configurações', async ({ page }) => {
  await expect(page.getByText('~/Documents/TechDocs')).toBeVisible();
  await page.getByRole('button', { name: 'Change…' }).click();
  expect(await last(page)).toEqual({ type: 'cloneDirectory' });
  await page.getByRole('checkbox', { name: /Move and rename in the Explorer/ }).check();
  expect(await last(page)).toEqual({ type: 'flag', key: 'syncExplorer', value: true });
  await page.getByRole('link', { name: /All settings in VS Code/ }).click();
  expect(await last(page)).toEqual({ type: 'openAll' });
});

test('sem site aberto: só as opções da pessoa', async ({ page }) => {
  await show(page, { ...STATE, templates: undefined, catalog: undefined });
  await expect(page.getByRole('radio', { name: /^For review/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Templates repository' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'catalog-info.yaml' })).toHaveCount(0);
});
