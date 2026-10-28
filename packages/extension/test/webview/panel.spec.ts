/** Webview do painel "Publicação": desenha o estado do host e devolve os cliques (spec 02, Publicação). */
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PanelState } from '../../src/publish/publishPanel';
import type { PublishView } from '../../src/publish/localPublisher';
import { serveExtension } from './webview';

/** Os textos em inglês do host, lidos de `panelLabels()` (o webview não tem `vscode.l10n`). */
const LABELS = Object.fromEntries(
  [...readFileSync(join(__dirname, '..', '..', 'src', 'publish', 'publishPanel.ts'), 'utf8').matchAll(/(\w+): vscode\.l10n\.t\('([^']*)'\)/g)].map(m => [m[1], m[2]]),
);

const VIEW: PublishView = {
  page: 'docs/index.md',
  branch: 'docs/ana/docs-index',
  onDefaultBranch: false,
  defaultBranch: 'main',
  pr: { number: 7, url: 'https://github.com/acme/wiki/pull/7', draft: true },
  unverified: false,
  busy: false,
  sendForReview: false,
  ownBranch: true,
  pipeline: true,
  checks: { summary: 'passed', items: [], stalled: false },
};

type Sent = { type: string; action?: string; url?: string; path?: string; line?: number };
const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent);

async function show(page: Page, state: PanelState) {
  await page.evaluate(message => window.postMessage(message, '*'), { type: 'state', state, labels: LABELS });
}

test.beforeEach(async ({ page }) => {
  await serveExtension(page);
  await page.goto('http://webview.test/test/webview/panel-harness.html');
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'ready')).toBe(true);
});

test('na branch principal: diz a branch que vai ser criada; Enviar desligado, sem Descartar', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, onDefaultBranch: true, pr: undefined } });
  await expect(page.getByText('Saving creates the branch docs/ana/docs-index from main.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send for publication' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Discard' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save draft' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'action', action: 'saveDraft' });
});

test('PR em rascunho verificado: Enviar ligado; com aprovações, "Enviar para revisão"', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, sendForReview: true } });
  await page.getByRole('button', { name: 'Send for review' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'action', action: 'send' });
  await page.getByRole('link', { name: 'Pull request #7' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'openUrl', url: 'https://github.com/acme/wiki/pull/7' });
});

test('salvo sem verificar: Enviar desligado com o aviso', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, unverified: true } });
  await expect(page.getByRole('button', { name: 'Send for publication' })).toBeDisabled();
  await expect(page.getByText('Saved without checking. Save and check before sending.')).toBeVisible();
});

test('ocupado: todos os botões desligados', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, busy: true } });
  for (const button of await page.getByRole('button').all()) await expect(button).toBeDisabled();
});

test('check que falhou: apontamento em linguagem simples, "ver linha" e detalhes (P3)', async ({ page }) => {
  await show(page, {
    status: 'ready',
    view: {
      ...VIEW,
      checks: {
        summary: 'failed',
        stalled: false,
        items: [
          {
            name: 'Formatação do texto',
            state: 'failed',
            url: 'https://github.com/acme/wiki/runs/1',
            help: 'Rode o ajuste automático.',
            annotations: [{ path: 'docs/index.md', line: 5, text: 'Space at the end of the line', snippet: 'Outra linha' }],
          },
          { name: 'Links', state: 'passed', url: 'https://github.com/acme/wiki/runs/2', annotations: [] },
        ],
      },
    },
  });
  await expect(page.getByText('Some checks failed. Fix the points below and save again.')).toBeVisible();
  await expect(page.getByText('Rode o ajuste automático.')).toBeVisible();
  await expect(page.getByText('Space at the end of the line')).toBeVisible();
  await page.getByRole('link', { name: 'Line 5' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'showLine', path: 'docs/index.md', line: 5 });
  await page.getByRole('link', { name: 'Details' }).first().click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'openUrl', url: 'https://github.com/acme/wiki/runs/1' });
  await page.getByRole('link', { name: 'Refresh' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'action', action: 'refresh' });
});

test('nenhum check depois do tempo de início: avisa (P4); erro de consulta aparece (P5)', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, checks: { summary: 'none', items: [], stalled: true, pollError: 'Server Error' } } });
  await expect(page.getByText('No check started on GitHub. Open the pull request to see why.')).toBeVisible();
  await expect(page.getByText('Server Error')).toBeVisible();
});

test('sem pipeline: a verificação é a do editor (P6)', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, pipeline: false } });
  await expect(page.getByText(LABELS.editorChecks)).toBeVisible();
});

test('texto do host não vira HTML', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, error: '<img src=x onerror="window.hacked=1">' } });
  await expect(page.getByRole('alert')).toHaveText('<img src=x onerror="window.hacked=1">');
  expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();
});

test('sem login: botão de entrar', async ({ page }) => {
  await show(page, { status: 'signIn', host: 'github.com' });
  await page.getByRole('button', { name: 'Sign in to GitHub' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'action', action: 'signIn' });
});

test('admin: o que falta no repositório e o botão de configurar (P7)', async ({ page }) => {
  await show(page, { status: 'ready', view: { ...VIEW, setup: { steps: ['workflow', 'markdownlint'] } } });
  await expect(page.getByText('automatic checks on pull requests')).toBeVisible();
  await expect(page.getByText('file with the formatting rules')).toBeVisible();
  await page.getByRole('button', { name: 'Set up checks' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'action', action: 'setUp' });
});
