/**
 * Vídeos curtos do README, gravados no VS Code de verdade. Cada teste grava um vídeo (webm) na sua
 * pasta; scripts/make-videos.mjs corta o começo (a abertura do VS Code) e converte em GIF.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { cursorToEnd } from '../../test/webview/editing';
import { expect, openFile, openVisualCommand, prose, runCommand, test, visual } from '../vscode';

export const OUT = join(__dirname, '../../../../node_modules/.cache/editor-videos');
const SIZE = { width: 1280, height: 800 };

/**
 * O Playwright não desenha o ponteiro: um cursor e uma legenda por cima da janela do VS Code. O cursor
 * é posto pelo próprio teste (o editor visual fica num iframe, e os movimentos do mouse lá dentro não
 * chegam à janela).
 */
async function overlay(page: Page) {
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
const caption = (page: Page, text: string, place: 'bottom' | 'top' = 'bottom') =>
  page.evaluate(({ t, top }) => {
    const element = document.getElementById('demo-caption')!;
    element.textContent = t;
    element.classList.toggle('on', Boolean(t));
    element.classList.toggle('top', top);
  }, { t: text, top: place === 'top' });

/** Leva o cursor desenhado até o elemento, devagar como uma pessoa, e clica. */
async function clickLike(page: Page, target: Locator, options: { dblclick?: boolean } = {}) {
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

const typeSlowly = (page: Page, text: string) => page.keyboard.type(text, { delay: 60 });
const pause = (page: Page, ms = 1_200) => page.waitForTimeout(ms);

/** Marca onde o vídeo começa a interessar (depois da abertura do VS Code). */
function markStart(name: string, startedAt: number) {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, 'starts.json');
  let starts: Record<string, number> = {};
  try {
    starts = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // primeiro vídeo
  }
  starts[name] = (Date.now() - startedAt) / 1000;
  writeFileSync(path, JSON.stringify(starts, null, 2));
}

const scene = (name: string) => ({ recordDir: join(OUT, name), windowSize: SIZE });

const docsView = (page: Page) =>
  page.locator('.pane', { has: page.locator('.pane-header', { hasText: /^Documentation/i }) });

test.describe('visual-editor', () => {
  test.use({ ...scene('visual-editor'), settings: { 'techdocsEditor.openVisualByDefault': true } });
  test('editar no visual, com o texto ao lado', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await expect(docsView(page).locator('.pane-header')).toBeVisible({ timeout: 30_000 });
    // Espaço para a árvore: a lista de pastas do workspace recolhida e a Documentação em foco
    const folders = page.locator('.pane-header').filter({ hasText: /techdocs-editor-test/i }).first();
    if ((await folders.getAttribute('aria-expanded')) === 'true') await folders.click();
    await runCommand(page, 'Focus on Documentation View');
    markStart('visual-editor', startedAt);
    await caption(page, 'Pick a page in the Documentation tree');
    const rows = docsView(page).locator('.monaco-list-row');
    await clickLike(page, rows.filter({ hasText: /^Guias$/ }).first());
    await clickLike(page, rows.filter({ hasText: /^Primeiros passos$/ }).first());
    await prose(page).waitFor({ timeout: 30_000 });
    await caption(page, 'It opens in the visual editor');
    await pause(page);
    await caption(page, 'Show the Markdown text side by side');
    await runCommand(page, 'TechDocs: Open as Markdown text');
    await pause(page, 1_500);
    await caption(page, 'Write as in any text editor…');
    await clickLike(page, prose(page).locator('> p').first());
    // No fim do parágrafo (o End iria só ao fim da linha na tela, e o parágrafo quebra em duas)
    await cursorToEnd(page, prose(page).locator('> p').first());
    await typeSlowly(page, ' Edit it like a document: no Markdown needed.');
    await pause(page, 900);
    await caption(page, '…and the Markdown follows, with one undo history');
    await pause(page, 1_800);
    await page.keyboard.press('Control+S');
    await caption(page, 'Ctrl+S saves the file');
    await pause(page, 1_500);
  });
});

test.describe('lint-and-fix', () => {
  test.use(scene('lint-and-fix'));
  test('problemas em linguagem simples, ver a linha e ajustar', async ({ vscode: { page, workspace, startedAt } }) => {
    appendFileSync(join(workspace, 'wiki/docs/index.md'), '\n# Perguntas frequentes\n\nResposta curta.   \n');
    await overlay(page);
    await openFile(page, 'wiki/docs/index.md');
    await openVisualCommand(page);
    await prose(page).waitFor({ timeout: 30_000 });
    const problems = visual(page).locator('.problems');
    await expect(problems).toBeVisible();
    markStart('lint-and-fix', startedAt);
    await caption(page, 'Formatting problems in plain language, as the pipeline will see them', 'top');
    await pause(page, 2_200);
    await caption(page, 'The line number opens the Markdown text right at the problem', 'top');
    await clickLike(page, problems.locator('.problem-line').first());
    await pause(page, 2_000);
    await caption(page, 'One click fixes what can be fixed automatically', 'top');
    await clickLike(page, problems.getByRole('button', { name: 'Fix automatically' }));
    await expect(problems).toHaveCount(0);
    await pause(page, 2_000);
  });
});

test.describe('images', () => {
  test.use(scene('images'));
  test('imagem do computador vai para docs/assets', async ({ vscode: { page, workspace, startedAt } }) => {
    const png = readFileSync(join(workspace, 'wiki/docs/assets/diagrama.png'));
    await overlay(page);
    await openFile(page, 'wiki/docs/guias/primeiros-passos.md');
    await openVisualCommand(page);
    await prose(page).waitFor({ timeout: 30_000 });
    markStart('images', startedAt);
    await caption(page, 'Type / to insert a block');
    await clickLike(page, prose(page).locator('> p').first());
    // No fim do parágrafo (o End iria só ao fim da linha na tela, e o parágrafo quebra em duas)
    await cursorToEnd(page, prose(page).locator('> p').first());
    await page.keyboard.press('Enter');
    await typeSlowly(page, '/');
    await pause(page, 900);
    await clickLike(page, visual(page).getByRole('listitem').getByText('Image', { exact: true }));
    const block = visual(page).locator('.milkdown-image-block');
    await caption(page, 'Choose an image from your computer');
    const chooser = page.waitForEvent('filechooser');
    await clickLike(page, block.locator('label.uploader'));
    await (await chooser).setFiles({ name: 'Architecture overview.png', mimeType: 'image/png', buffer: png });
    await expect(block.locator('img')).toBeVisible();
    await caption(page, 'Saved to docs/assets, linked relative to the page');
    await pause(page, 1_000);
    await runCommand(page, 'TechDocs: Open as Markdown text');
    await pause(page, 2_500);
    // Salvo: com alteração pendente, o VS Code pergunta antes de fechar e o vídeo não termina
    await page.keyboard.press('Control+S');
    await pause(page, 500);
  });
});

test.describe('search', () => {
  test.use(scene('search'));
  test('Ctrl+F no visual', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await openFile(page, 'wiki/docs/processos/aprovacao.md');
    await openVisualCommand(page);
    await prose(page).waitFor({ timeout: 30_000 });
    markStart('search', startedAt);
    await clickLike(page, prose(page).locator('> p').first());
    await caption(page, 'Ctrl+F searches the visual editor');
    await page.keyboard.press('Control+F');
    await typeSlowly(page, 'altera');
    await pause(page, 900);
    await caption(page, 'Enter goes to the next match');
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Enter');
      await pause(page, 700);
    }
    await caption(page, 'Esc closes and goes back to the text');
    await page.keyboard.press('Escape');
    await pause(page, 1_500);
  });
});
