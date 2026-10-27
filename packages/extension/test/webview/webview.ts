import { expect, Page } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HARNESS = pathToFileURL(join(__dirname, 'harness.html')).href;

type Sent = { type: string; text?: string; id?: number };

export const sent = (page: Page) => page.evaluate(() => (window as unknown as { sent: Sent[] }).sent);

/** Abre o webview com o arquivo `text` (formato do repositório) e espera o editor ficar pronto. */
export async function openWebview(page: Page, text: string, language = 'pt-br') {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(HARNESS);
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'loaded'), { message: 'webview carregado' }).toBe(true);
  await page.evaluate(
    message => window.postMessage(message, '*'),
    { type: 'init', text, language, baseUri: 'file:///wiki/docs' },
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

/** Último texto que o webview mandou ao host como edição. */
export async function lastEdit(page: Page): Promise<string | undefined> {
  return (await sent(page)).filter(m => m.type === 'edit').at(-1)?.text;
}
