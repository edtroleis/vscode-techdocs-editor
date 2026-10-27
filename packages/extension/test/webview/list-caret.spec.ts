import { expect, test } from '@playwright/test';
import { newLineAtEnd, slash } from './editing';
import { lastEdit, openWebview } from './webview';

/**
 * Mesmo cenário do plugin (e2e/tests/list-caret.spec.ts), agora no bundle do webview: digitar logo
 * depois de criar um item de lista, com a máquina ocupada, não pode trocar as letras ("oisd").
 * Os quadros de animação atrasam 300 ms e a primeira letra entra antes do quadro (listCaretFix.ts).
 */
const SLOW_FRAMES = `
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const frames = new Map();
  let next = 1;
  window.requestAnimationFrame = callback => {
    const id = next++;
    const timer = setTimeout(() => frames.set(id, raf(time => { frames.delete(id); callback(time); })), 300);
    frames.set(id, { timer });
    return id;
  };
  window.cancelAnimationFrame = id => {
    const frame = frames.get(id);
    if (frame && typeof frame === 'object') clearTimeout(frame.timer);
    else if (frame) caf(frame);
    frames.delete(id);
  };
`;

const ORIGINAL = '# Página\n\nTexto inicial.\n';

const lists = [
  { label: 'Lista com marcadores', marker: '- ' },
  { label: 'Lista numerada', marker: '1. ' },
  { label: 'Lista de tarefas', marker: '- [ ] ' },
];

for (const { label, marker } of lists) {
  test(`${label}: letra digitada antes do quadro seguinte fica no lugar`, async ({ page }) => {
    await page.addInitScript(SLOW_FRAMES);
    await openWebview(page, ORIGINAL);
    await newLineAtEnd(page);
    await slash(page, label);
    await page.keyboard.type('um');
    await page.keyboard.press('Enter');
    await page.keyboard.type('d');
    // O quadro atrasado (com a devolução do cursor do Crepe) roda aqui
    await page.waitForTimeout(700);
    await page.keyboard.type('ois');
    const second = marker === '1. ' ? '2. ' : marker;
    await expect.poll(() => lastEdit(page), { timeout: 10_000 }).toBe(`${ORIGINAL}\n${marker}um\n${second}dois\n`);
  });
}

test('a edição chega ao host como texto do repositório (fromEditor), em inglês também', async ({ page }) => {
  await openWebview(page, ORIGINAL, 'en');
  await newLineAtEnd(page);
  await slash(page, 'Bulleted list');
  await page.keyboard.type('item');
  await expect.poll(() => lastEdit(page), { timeout: 10_000 }).toBe(`${ORIGINAL}\n- item\n`);
});
