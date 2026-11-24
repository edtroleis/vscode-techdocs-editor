/** Webview da tela de envio (spec 09, telas 2, 6 e 15): desenha o estado do host e devolve os cliques. */
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SendPanelState } from '../../src/send/sendPanel';
import { serveExtension } from './webview';

/** Os textos em inglês do host, lidos de `sendLabels()`. */
const LABELS = Object.fromEntries(
  [...readFileSync(join(__dirname, '..', '..', 'src', 'send', 'sendPanel.ts'), 'utf8').matchAll(/(\w+): vscode\.l10n\.t\('([^']*)'\)/g)].map(m => [m[1], m[2]]),
);

const GUIA = { root: '', docsDir: 'docs', mkdocs: 'mkdocs.yml', title: 'Guia' };
const API = { root: 'api', docsDir: 'api/docs', mkdocs: 'api/mkdocs.yml', title: 'API' };
const STATE: SendPanelState = {
  groups: [
    {
      site: GUIA,
      items: [
        { kind: 'page', change: 'modified', path: 'docs/a.md', site: '', title: 'Como integrar' },
        { kind: 'page', change: 'added', path: 'docs/faq.md', site: '', title: 'Perguntas frequentes' },
        { kind: 'moved', from: 'docs/alertas.md', path: 'docs/operacao/alertas.md', site: '', title: 'Alertas' },
        { kind: 'page', change: 'deleted', path: 'docs/v1.md', site: '', title: 'Integração v1' },
        { kind: 'images', paths: ['docs/assets/a.png', 'docs/assets/b.png'], site: '', usedIn: ['docs/a.md'] },
        { kind: 'menu', path: 'mkdocs.yml', site: '' },
      ],
    },
    { site: API, items: [{ kind: 'page', change: 'modified', path: 'api/docs/auth.md', site: 'api', title: 'Autenticação' }] },
  ],
  outside: ['src/a.ts', 'package.json', 'README.md'],
  summary: 'Guia: atualiza Como integrar. API: atualiza Autenticação',
  checks: [],
  primary: 'review',
  busy: false,
};

type Sent = { type: string; index?: number; path?: string; summary?: string };
const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent);
const show = (page: Page, state: SendPanelState) =>
  page.evaluate(message => window.postMessage(message, '*'), { type: 'state', state, labels: LABELS });

test.beforeEach(async ({ page }) => {
  await serveExtension(page);
  await page.goto('http://webview.test/test/webview/send-harness.html');
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'ready')).toBe(true);
});

test('agrupa por site com a contagem e o tipo de cada mudança', async ({ page }) => {
  await show(page, STATE);
  await expect(page.getByRole('heading', { name: 'Send 7 changes from 2 sites' })).toBeVisible();
  await expect(page.getByText('Guia · 6 changes')).toBeVisible();
  await expect(page.getByText('API · 1 change')).toBeVisible();
  for (const kind of ['CHANGED', 'NEW', 'MOVED', 'REMOVED', 'IMAGES', 'MENU']) await expect(page.getByText(kind, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('docs/alertas.md → docs/operacao/alertas.md')).toBeVisible();
  await expect(page.getByText('2 new images used in Como integrar')).toBeVisible();
});

test('Desfazer manda o índice do item; Ver o que mudou manda o caminho', async ({ page }) => {
  await show(page, STATE);
  await page.getByRole('button', { name: 'Undo' }).nth(2).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'undo', index: 2 });
  await page.getByRole('link', { name: 'See what changed' }).first().click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'diff', path: 'docs/a.md' });
});

test('o resumo editado vai no envio', async ({ page }) => {
  await show(page, { ...STATE, groups: [STATE.groups[0]] });
  await page.getByLabel('What changed').fill('Corrige o prazo do estorno');
  await page.getByRole('button', { name: 'Send for review' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'send', summary: 'Corrige o prazo do estorno' });
});

test('um problema sem correção trava o envio, com o motivo; o que tem correção oferece Corrigir', async ({ page }) => {
  await show(page, {
    ...STATE,
    checks: [
      { kind: 'fixable', text: '2 formatting details' },
      { kind: 'blocking', text: 'Broken link: alertas-antigos.md', path: 'docs/a.md', line: 12 },
    ],
  });
  await expect(page.getByRole('button', { name: 'Send for review' })).toBeDisabled();
  await expect(page.getByText('Fix the problems above to send')).toBeVisible();
  await page.getByRole('button', { name: 'Fix' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'fix' });
  await page.getByRole('link', { name: 'See on the page' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'open', path: 'docs/a.md', line: 12 });
});

test('avisa o que fica fora e, sem revisão, o botão é Publicar', async ({ page }) => {
  await show(page, { ...STATE, primary: 'publish' });
  await expect(page.getByText('3 files outside the documentation are not sent')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled();
  await page.getByRole('link', { name: 'See which' }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'showOutside' });
});

test('nenhum termo do Git na tela', async ({ page }) => {
  await show(page, { ...STATE, checks: [{ kind: 'fixable', text: 'x' }] });
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['branch', 'commit', 'push', 'pull request', 'merge']) expect(text).not.toContain(word);
});
