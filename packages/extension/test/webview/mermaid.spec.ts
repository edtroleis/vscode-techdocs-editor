/** Diagramas Mermaid no webview (spec 06, M2): o tema do diagrama segue o do VS Code. */
import { expect, Page, test } from '@playwright/test';
import { openWebview } from './webview';

const PAGE = '# Página\n\n```mermaid\nflowchart LR\n  A-->B\n```\n';
// Preenchimento das caixas em cada tema do Mermaid
const DARK_FILL = '#1f2020';
const svg = (page: Page) => page.locator('.mermaid-diagram svg');
/** O diagrama está com o tema escuro (sem despejar o SVG inteiro numa falha). */
const dark = (page: Page) => svg(page).evaluate((el, fill) => el.outerHTML.includes(fill), DARK_FILL);
const setBodyClass = (page: Page, name: string) => page.evaluate(n => (document.body.className = n), name);

test('tema escuro do VS Code desenha com o tema escuro; trocar o tema redesenha', async ({ page }) => {
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => (document.body.className = 'vscode-dark')));
  await openWebview(page, PAGE);
  await expect(svg(page)).toBeVisible();
  expect(await dark(page)).toBe(true);
  await setBodyClass(page, 'vscode-light');
  await expect.poll(() => dark(page)).toBe(false);
  await setBodyClass(page, 'vscode-high-contrast');
  await expect.poll(() => dark(page)).toBe(true);
});

test('diagrama que pede o layout ELK é desenhado com o layout padrão (o ELK não vai no pacote, como no site)', async ({ page }) => {
  await openWebview(page, '# Página\n\n```mermaid\n---\nconfig:\n  layout: elk\n---\nflowchart LR\n  A-->B\n```\n');
  await expect(svg(page)).toBeVisible();
  await expect(page.locator('.mermaid-error')).toHaveCount(0);
});
