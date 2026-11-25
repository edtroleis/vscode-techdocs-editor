/**
 * Jeito de pessoa nos testes do VS Code: um cursor desenhado, uma legenda por cima da janela, cliques com o cursor
 * indo até o alvo e digitação no ritmo de quem escreve. Usado pelos vídeos do README e pelos cenários de usuário.
 */
import type { Locator, Page } from '@playwright/test';

/**
 * O Playwright não desenha o ponteiro: um cursor e uma legenda por cima da janela do VS Code. O cursor
 * é posto pelo próprio teste (o editor visual fica num iframe, e os movimentos do mouse lá dentro não
 * chegam à janela).
 */
export async function overlay(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #demo-cursor { position: fixed; z-index: 2147483647; width: 24px; height: 24px; left: 640px; top: 400px;
        pointer-events: none; transition: left .45s ease-in-out, top .45s ease-in-out, transform .08s;
        background: no-repeat center/contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M3 2l16 9-7 2-3 7z' fill='%23111' stroke='%23fff' stroke-width='1.5'/%3E%3C/svg%3E"); }
      #demo-cursor.down { transform: scale(.8); }
      #demo-caption { position: fixed; z-index: 2147483646; left: 50%; bottom: 40px; transform: translateX(-50%);
        max-width: 80%; padding: 10px 18px; border-radius: 8px; background: rgba(17,17,17,.88); color: #fff;
        font: 500 20px/1.3 system-ui, sans-serif; pointer-events: none; opacity: 0; transition: opacity .2s; }
      #demo-caption.on { opacity: 1; }
      #demo-caption.top { top: 110px; bottom: auto; }`;
    document.head.appendChild(style);
    for (const id of ['demo-cursor', 'demo-caption']) {
      const element = document.createElement('div');
      element.id = id;
      document.body.appendChild(element);
    }
  });
}

/** Legenda embaixo; `top` quando o que importa está embaixo (a lista de problemas). */
export const caption = (page: Page, text: string, place: 'bottom' | 'top' = 'bottom') =>
  page.evaluate(({ t, top }) => {
    const element = document.getElementById('demo-caption')!;
    element.textContent = t;
    element.classList.toggle('on', Boolean(t));
    element.classList.toggle('top', top);
  }, { t: text, top: place === 'top' });

/** Leva o cursor desenhado até o elemento, devagar como uma pessoa, e clica. */
export async function clickLike(page: Page, target: Locator, options: { dblclick?: boolean } = {}) {
  // Painel que se redesenha (a cada letra digitada, a cada resposta da extensão): o elemento pode trocar entre achar e
  // rolar até ele; procura de novo em vez de falhar
  let box: { x: number; y: number; width: number; height: number } | null = null;
  for (let attempt = 0; !box; attempt++) {
    try {
      await target.scrollIntoViewIfNeeded();
      box = await target.boundingBox();
    } catch (error) {
      if (attempt >= 5 || !/not attached|detached/i.test(String(error))) throw error;
    }
    if (!box) await page.waitForTimeout(200);
  }
  await page.evaluate(({ x, y }) => {
    const cursor = document.getElementById('demo-cursor')!;
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('demo-cursor')!.classList.add('down'));
  await (options.dblclick ? target.dblclick() : target.click());
  await page.evaluate(() => document.getElementById('demo-cursor')!.classList.remove('down'));
}

/** Arrasta de `from` até `to` com o cursor de demonstração junto, devagar (para os vídeos). */
export async function dragLike(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cursorAt = (x: number, y: number) =>
    page.evaluate(({ x, y }) => {
      const cursor = document.getElementById('demo-cursor')!;
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    }, { x, y });
  await cursorAt(start.x, start.y);
  await page.waitForTimeout(600);
  await page.mouse.move(start.x, start.y);
  await page.evaluate(() => document.getElementById('demo-cursor')!.classList.add('down'));
  await page.mouse.down();
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const x = start.x + ((end.x - start.x) * i) / steps;
    const y = start.y + ((end.y - start.y) * i) / steps;
    await page.mouse.move(x, y);
    await cursorAt(x, y);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.evaluate(() => document.getElementById('demo-cursor')!.classList.remove('down'));
}

export const typeSlowly = (page: Page, text: string) => page.keyboard.type(text, { delay: 60 });
export const pause = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

