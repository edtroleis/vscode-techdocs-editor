import { BrowserContext, expect, Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Pasta do pacote da extensão, servida em http://webview.test (módulos ES não carregam de file://). */
const ROOT = join(__dirname, '..', '..');
const ORIGIN = 'http://webview.test';
const HARNESS = `${ORIGIN}/test/webview/harness.html`;

/** Responde os pedidos a http://webview.test com os arquivos do pacote, sem abrir porta. */
export const serveExtension = (target: Page | BrowserContext) =>
  target.route(`${ORIGIN}/**`, route => {
    const path = join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
    return existsSync(path) ? route.fulfill({ path }) : route.fulfill({ status: 404 });
  });

type Sent = { type: string; text?: string; after?: string; id?: number; line?: number };

/** Os textos que o host manda no `init` (os em inglês do `vscode.l10n`). */
export const LABELS = {
  problemsOne: '1 formatting problem',
  problemsOther: '{0} formatting problems',
  fixAll: 'Fix automatically',
  line: 'Line {0}',
  showLine: 'Show line {0} in the Markdown text',
  more: 'More actions',
};

export const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent);

/** Abre o webview com o arquivo `text` (formato do repositório) e espera o editor ficar pronto. */
export async function openWebview(page: Page, text: string, language = 'pt-br') {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await serveExtension(page);
  await page.goto(HARNESS);
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'loaded'), { message: 'webview carregado' }).toBe(true);
  await page.evaluate(
    message => window.postMessage(message, '*'),
    { type: 'init', text, language, baseUri: 'file:///wiki/docs', labels: LABELS },
  );
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'ready'), { message: 'editor pronto' }).toBe(true);
  return { errors };
}

/** O que o editor gravaria agora (mesma mensagem que o host usa nos testes). */
export async function savedText(page: Page): Promise<string> {
  const id = Math.floor(Math.random() * 1e9);
  await page.evaluate(message => window.postMessage(message, '*'), { type: 'test:getSaved', id });
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'test:saved' && m.id === id)).toBe(true);
  return (await sent(page)).find(m => m.type === 'test:saved' && m.id === id)!.text!;
}

/** Texto depois da última edição que o webview mandou ao host. */
export async function lastEdit(page: Page): Promise<string | undefined> {
  return (await sent(page)).filter(m => m.type === 'edit').at(-1)?.after;
}

/** Mensagem do host para o webview. */
export const fromHost = (page: Page, message: object) => page.evaluate(m => window.postMessage(m, '*'), message);
