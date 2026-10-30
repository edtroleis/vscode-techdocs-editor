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
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
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

export const typeSlowly = (page: Page, text: string) => page.keyboard.type(text, { delay: 60 });
export const pause = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

