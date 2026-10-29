/** Webview da tela de conflito (4e, M5): mostra os trechos e devolve a escolha de cada um. */
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MergeChunk } from '@edtroleis/techdocs-editor-core';
import { serveExtension } from './webview';

/** Os textos em inglês do host, lidos de `conflictLabels()`. */
const LABELS: Record<string, string> = {
  ...Object.fromEntries(
    [...readFileSync(join(__dirname, '..', '..', 'src', 'remote', 'conflictPanel.ts'), 'utf8').matchAll(/(\w+): vscode\.l10n\.t\('([^']*)'\)/g)].map(m => [m[1], m[2]]),
  ),
  other: 'Published version',
};

const CHUNKS: MergeChunk[] = [
  { kind: 'same', lines: ['# Deploy', '', 'Passo 1.'] },
  { kind: 'conflict', mine: ['Meu passo 2.'], theirs: ['Passo 2 publicado.'] },
  { kind: 'same', lines: ['', 'Fim.'] },
  { kind: 'conflict', mine: [], theirs: ['Nota publicada.'] },
];

type Sent = { type: string; choices?: string[] };
const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent);

test.beforeEach(async ({ page }) => {
  await serveExtension(page);
  await page.goto('http://webview.test/test/webview/conflict-harness.html');
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'ready')).toBe(true);
  await page.evaluate(message => window.postMessage(message, '*'), { type: 'init', chunks: CHUNKS, labels: LABELS, total: 2 });
});

test('os trechos com as duas versões e o contexto; Concluir só depois de escolher todos', async ({ page }) => {
  const first = page.getByRole('region', { name: 'Passage 1 of 2' });
  await expect(first).toContainText('Passage 1 of 2');
  await expect(first).toContainText('Passo 1.');
  await expect(first).toContainText('Passo 2 publicado.');
  await expect(first).toContainText('Meu passo 2.');
  await expect(page.getByRole('region', { name: 'Passage 2 of 2' })).toContainText(LABELS.removed);

  const finish = page.getByRole('button', { name: LABELS.finish });
  await expect(finish).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('2 passage(s) left to choose');

  await first.getByRole('button', { name: LABELS.keepMine }).click();
  await expect(first.getByRole('button', { name: LABELS.keepMine })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('region', { name: 'Passage 2 of 2' }).getByRole('button', { name: LABELS.keepBoth }).click();
  await finish.click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'done', choices: ['mine', 'both'] });
});

test('Cancelar devolve sem escolhas', async ({ page }) => {
  await page.getByRole('button', { name: LABELS.cancel }).click();
  expect((await sent(page)).at(-1)).toEqual({ type: 'cancel' });
});
