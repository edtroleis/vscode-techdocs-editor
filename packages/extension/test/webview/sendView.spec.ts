/** Webview do painel Envio (spec 09, telas 4, 9, 10 e 14): o andamento em linguagem simples. */
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SendState } from '../../src/send/sender';
import { serveExtension } from './webview';

const LABELS = Object.fromEntries(
  [...readFileSync(join(__dirname, '..', '..', 'src', 'send', 'sendView.ts'), 'utf8').matchAll(/(\w+): vscode\.l10n\.t\('([^']*)'\)/g)].map(m => [m[1], m[2]]),
);

const REVIEW: SendState = {
  status: 'inReview',
  pr: { number: 7, url: 'https://github.com/acme/guia/pull/7' },
  title: 'Atualiza Como integrar e mais 2',
  pending: 0,
  checks: { summary: 'running', stalled: false, items: [{ name: 'lint das docs', state: 'running', url: 'https://x', annotations: [] }] },
  review: 'waiting',
  requiredApprovals: 1,
};

type Sent = { type: string; action?: string; url?: string; path?: string; line?: number };
const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent);
const show = (page: Page, state: SendState | undefined, count = 0) =>
  page.evaluate(message => window.postMessage(message, '*'), { type: 'state', state, count, labels: LABELS });

test.beforeEach(async ({ page }) => {
  await serveExtension(page);
  await page.goto('http://webview.test/test/webview/send-view-harness.html');
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'ready')).toBe(true);
});

test('em revisão: enviado, verificando e esperando revisão; Desistir e o link', async ({ page }) => {
  await show(page, REVIEW);
  await expect(page.getByText('Atualiza Como integrar e mais 2')).toBeVisible();
  await expect(page.getByText('Sent')).toBeVisible();
  await expect(page.getByText('Checking')).toBeVisible();
  await expect(page.getByText('Waiting for review')).toBeVisible();
  await page.getByRole('link', { name: 'see on GitHub' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'openUrl', url: 'https://github.com/acme/guia/pull/7' });
  await page.getByRole('button', { name: 'Give up this send' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'action', action: 'giveUp' });
});

test('mudança nova depois de enviar: Enviar de novo', async ({ page }) => {
  await show(page, { ...REVIEW, pending: 1 });
  await page.getByRole('button', { name: 'Send again' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'action', action: 'send' });
});

test('a verificação falhou: o problema com Ver na linha', async ({ page }) => {
  await show(page, {
    ...REVIEW,
    checks: {
      summary: 'failed',
      stalled: false,
      items: [{ name: 'lint das docs', state: 'failed', url: 'https://x', annotations: [{ path: 'docs/a.md', line: 12, text: 'Broken link' }] }],
    },
  });
  await expect(page.getByText('The check found a problem')).toBeVisible();
  await page.getByRole('link', { name: 'See the line' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'showLine', path: 'docs/a.md', line: 12 });
});

test('aprovado e na branch principal, sem falar do Backstage', async ({ page }) => {
  await show(page, { status: 'merged', by: 'carla' });
  await expect(page.getByText('Approved by carla and in the documentation')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('Backstage');
});

test('nenhum termo do Git no painel', async ({ page }) => {
  for (const state of [REVIEW, { status: 'merged' } as SendState, { status: 'offline', retrying: true } as SendState]) {
    await show(page, state);
    const text = (await page.locator('body').innerText()).toLowerCase();
    for (const word of ['branch', 'commit', 'push', 'pull request', 'merge']) expect(text, `${state.status}`).not.toContain(word);
  }
});
