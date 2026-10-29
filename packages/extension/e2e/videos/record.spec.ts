/**
 * Vídeos curtos do README, gravados no VS Code de verdade. Cada teste grava um vídeo (webm) na sua
 * pasta; scripts/make-videos.mjs corta o começo (a abertura do VS Code) e converte em GIF.
 */
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const pane = (page: Page, title: RegExp) => page.locator('.pane', { has: page.locator('.pane-header', { hasText: title }) });
const docsView = (page: Page) => pane(page, /^Documentation/i);
const checkView = (page: Page) => pane(page, /^Check/i);

/** O ícone TechDocs na barra de atividades, clicado como uma pessoa. */
async function openSidebar(page: Page) {
  const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
  await expect(icon).toBeVisible({ timeout: 30_000 });
  await clickLike(page, icon);
  await expect(docsView(page).locator('.pane-header')).toBeVisible();
}

/**
 * Escolhe um item da lista aberta: o cursor desenhado vai até ele e a escolha é pelo teclado (filtrar pelo rótulo e
 * Enter). Clicar falha quando a dica de outra linha fica por cima.
 */
async function pick(page: Page, label: string) {
  const row = page.locator('.quick-input-list .monaco-list-row', { hasText: label }).first();
  await row.waitFor();
  await pause(page, 700);
  const box = await row.boundingBox();
  if (box) {
    await page.evaluate(({ x, y }) => {
      const cursor = document.getElementById('demo-cursor')!;
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    }, { x: box.x + 60, y: box.y + box.height / 2 });
  }
  await quickInput(page).focus();
  await typeSlowly(page, label);
  await pause(page, 500);
  await page.keyboard.press('Enter');
  await pause(page, 500);
}

/** Sem site no workspace: só o que a cena precisa. */
function clearSites(workspace: string, keep: string[] = []) {
  for (const path of ['wiki', 'wiki-demo', 'crlf'].filter(p => !keep.includes(p))) rmSync(join(workspace, path), { recursive: true, force: true });
}

/** Botão de um item de árvore (só aparece com o mouse em cima). */
async function rowAction(page: Page, row: Locator, label: string) {
  await row.hover();
  await clickLike(page, row.locator(`.action-label[aria-label^="${label}"]`));
}

const quickInput = (page: Page) => page.locator('.quick-input-widget input');

/** Responde à caixa de texto ou lista aberta: troca o texto (se houver) e confirma. */
async function answer(page: Page, text?: string) {
  await quickInput(page).waitFor();
  await pause(page, 500);
  if (text !== undefined) {
    await page.keyboard.press('Control+A');
    await typeSlowly(page, text);
    await pause(page, 600);
  }
  await page.keyboard.press('Enter');
  await pause(page, 500);
}

test.describe('visual-editor', () => {
  test.use({ ...scene('visual-editor'), settings: { 'techdocsEditor.openVisualByDefault': true } });
  test('editar no visual, com o texto ao lado', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    markStart('visual-editor', startedAt);
    await caption(page, 'The TechDocs icon opens your documentation');
    await openSidebar(page);
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

test.describe('new-page', () => {
  test.use(scene('new-page'));
  test('nova página a partir de template, na seção da árvore', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    markStart('new-page', startedAt);
    await openSidebar(page);
    const rows = docsView(page).locator('.monaco-list-row');
    await caption(page, 'New page, right where it goes in the tree');
    await rowAction(page, rows.filter({ hasText: /^Guias$/ }).first(), 'New page from template');
    await caption(page, 'Choose the kind of page: templates by purpose');
    await quickInput(page).waitFor();
    await pause(page, 1_500);
    await typeSlowly(page, 'how-to');
    await answer(page);
    await caption(page, 'Give it a title; the file name follows');
    await answer(page, 'Rotate the API keys');
    await answer(page);
    while (await quickInput(page).isVisible()) await answer(page);
    await prose(page).waitFor({ timeout: 30_000 });
    await caption(page, 'It opens with the first part to fill selected: just type');
    await pause(page, 1_200);
    await typeSlowly(page, 'New keys in place, old ones revoked, no downtime.');
    await pause(page, 1_200);
    await page.keyboard.press('Control+S');
    await caption(page, 'Saved in docs/guias, next to the other guides');
    await pause(page, 2_000);
  });
});

test.describe('check-and-fix', () => {
  test.use(scene('check-and-fix'));
  test('verificação por tipo, ir à linha e corrigir com o diff', async ({ vscode: { page, workspace, startedAt } }) => {
    // Um site só, com um link quebrado e o catalog-info.yaml sem a anotação do TechDocs
    rmSync(join(workspace, 'wiki-demo'), { recursive: true, force: true });
    appendFileSync(join(workspace, 'wiki/docs/processos/aprovacao.md'), '\nVeja também o [checklist de aprovação](checklist.md).\n');
    writeFileSync(
      join(workspace, 'wiki/catalog-info.yaml'),
      'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: wiki-demo\nspec:\n  type: documentation\n  owner: time-docs\n  lifecycle: production\n',
    );
    await overlay(page);
    markStart('check-and-fix', startedAt);
    await openSidebar(page);
    // Espaço para a Verificação: a árvore recolhida
    await clickLike(page, docsView(page).locator('.pane-header'));
    const rows = checkView(page).locator('.monaco-list-row');
    await expect(rows.filter({ hasText: 'checklist.md' }).first()).toBeVisible({ timeout: 30_000 });
    await caption(page, 'Check lists what TechDocs needs, grouped by kind', 'top');
    await pause(page, 2_200);
    await caption(page, 'Click to go to the line', 'top');
    await clickLike(page, rows.filter({ hasText: 'checklist.md' }).first());
    await expect(page.locator('.tab.active', { hasText: 'aprovacao.md' })).toBeVisible();
    await pause(page, 1_800);
    await caption(page, 'Fix shows the change before writing anything');
    await rowAction(page, rows.filter({ hasText: 'techdocs-ref' }).first(), 'Fix');
    await quickInput(page).waitFor();
    await pause(page, 2_500);
    await caption(page, 'Apply, and the check runs again');
    await page.keyboard.press('Enter');
    await expect(rows.filter({ hasText: 'techdocs-ref' })).toHaveCount(0, { timeout: 15_000 });
    await pause(page, 2_000);
  });
});

test.describe('new-site', () => {
  test.use(scene('new-site'));
  test('novo site de documentação a partir de template', async ({ vscode: { page, workspace, startedAt } }) => {
    // Workspace sem site nenhum: o site novo vai para a raiz
    for (const site of ['wiki', 'wiki-demo']) rmSync(join(workspace, site), { recursive: true, force: true });
    await overlay(page);
    await pause(page, 1_000);
    markStart('new-site', startedAt);
    await caption(page, 'New documentation site, from a template');
    await runCommand(page, 'TechDocs: New documentation site');
    await quickInput(page).waitFor();
    await pause(page, 1_800);
    await typeSlowly(page, 'service');
    await answer(page);
    await caption(page, 'Name it and answer the template questions');
    await answer(page, 'Payments service');
    await answer(page, 'team-payments');
    while (await quickInput(page).isVisible()) await answer(page);
    await prose(page).waitFor({ timeout: 30_000 });
    await caption(page, 'mkdocs.yml, nav and pages ready for TechDocs');
    await openSidebar(page);
    await pause(page, 2_500);
  });
});

test.describe('prepare-readme', () => {
  test.use(scene('prepare-readme'));
  test('repositório só com README: boas-vindas, README como página inicial e a pergunta do catálogo', async ({ vscode: { page, workspace, startedAt } }) => {
    clearSites(workspace);
    writeFileSync(join(workspace, 'README.md'), '# Payments\n\nThe service that charges the checkout.\n\n## Run it\n\n```sh\nmake run\n```\n');
    await overlay(page);
    const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
    await expect(icon).toBeVisible({ timeout: 30_000 });
    markStart('prepare-readme', startedAt);
    await caption(page, 'A repository with only a README: the TechDocs icon shows up');
    await clickLike(page, icon);
    const prepare = page.getByRole('button', { name: 'Prepare the documentation' });
    await prepare.waitFor();
    await pause(page, 1_800);
    await clickLike(page, prepare);
    await caption(page, 'The README can become the home page');
    await pick(page, 'Copy to docs/index.md');
    await caption(page, 'Choose the kind of site');
    await quickInput(page).waitFor();
    await pause(page, 1_000);
    await typeSlowly(page, 'service');
    await answer(page);
    await caption(page, 'Name it and answer the template questions');
    await answer(page, 'Payments');
    await answer(page, 'team-payments');
    const notSure = page.locator('.quick-input-list .monaco-list-row', { hasText: 'Not sure' });
    while ((await notSure.count()) === 0 && (await quickInput(page).isVisible())) await answer(page);
    await caption(page, 'Asked once: does your Backstage use catalog-info.yaml?');
    await pick(page, 'Yes');
    await prose(page).waitFor({ timeout: 30_000 });
    await caption(page, 'The README is the home page; mkdocs.yml, nav and pages are ready');
    await pause(page, 2_500);
  });
});

test.describe('adopt-docs', () => {
  test.use(scene('adopt-docs'));
  test('docs/ sem mkdocs.yml: usar as páginas que já existem', async ({ vscode: { page, workspace, startedAt } }) => {
    // As páginas da wiki numa docs/ na raiz, sem mkdocs.yml
    cpSync(join(workspace, 'wiki/docs'), join(workspace, 'docs'), { recursive: true });
    clearSites(workspace);
    await overlay(page);
    const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
    await expect(icon).toBeVisible({ timeout: 30_000 });
    markStart('adopt-docs', startedAt);
    await caption(page, 'Pages in docs/, but no mkdocs.yml');
    await clickLike(page, icon);
    const prepare = page.getByRole('button', { name: 'Prepare the documentation' });
    await prepare.waitFor();
    await pause(page, 1_800);
    await clickLike(page, prepare);
    await caption(page, 'Use the pages you already have');
    await pick(page, 'Use the pages that already exist');
    await caption(page, 'The site name comes from the home page');
    await answer(page);
    await caption(page, 'Only mkdocs.yml is created, with the nav from folders and titles');
    await pause(page, 2_500);
    await pick(page, 'Apply');
    await caption(page, 'No catalog-info.yaml in this Backstage? Say so once');
    await pick(page, 'No');
    await caption(page, 'Your pages, now a TechDocs site: none of them changed');
    await pause(page, 2_500);
  });
});

test.describe('check-options', () => {
  test.use(scene('check-options'));
  test('engrenagem da verificação: o modo do catalog-info.yaml, para o time', async ({ vscode: { page, workspace, startedAt } }) => {
    clearSites(workspace, ['wiki']);
    await overlay(page);
    markStart('check-options', startedAt);
    await openSidebar(page);
    await clickLike(page, docsView(page).locator('.pane-header'));
    const rows = checkView(page).locator('.monaco-list-row');
    await expect(rows.filter({ hasText: 'No catalog-info.yaml' }).first()).toBeVisible({ timeout: 30_000 });
    await caption(page, 'Without catalog-info.yaml: just a hint, not counted on the icon', 'top');
    await pause(page, 2_200);
    await caption(page, 'The gear sets how the check treats it', 'top');
    await checkView(page).locator('.pane-header').hover();
    await clickLike(page, checkView(page).locator('.pane-header .action-label[aria-label^="Check options"]'));
    await pause(page, 1_500);
    await caption(page, 'Our Backstage registers docs another way');
    await pick(page, 'Do not use it');
    await caption(page, 'Saved for the whole team in .techdocs-editor.yaml');
    await pick(page, 'For the team');
    await pause(page, 1_800);
    await pick(page, 'Apply');
    await expect(rows.filter({ hasText: 'No catalog-info.yaml' })).toHaveCount(0, { timeout: 15_000 });
    await caption(page, 'Nothing more about catalog-info.yaml', 'top');
    await pause(page, 2_000);
  });
});
