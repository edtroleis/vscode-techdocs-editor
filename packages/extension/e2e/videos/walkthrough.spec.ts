/**
 * Cenas do README sobre o site de exemplo em inglês (fixtures/payments): da instalação pelo Marketplace até
 * diagramas e formatação. Cada cena vira um GIF; as da lista WALKTHROUGH de scripts/make-videos.mjs, juntas, viram
 * o vídeo completo (docs/media/walkthrough.mp4).
 */
import type { FrameLocator, Page } from '@playwright/test';
import { caption, clickLike, overlay, pause, typeSlowly } from '../human';
import { answer, contextMenu, editorOf, expandRow, openFromTree, pick, previewPanel, quickInput, techdocsIcon, toast, treeRow } from '../scenarios/ui';
import { expect, runCommand, test } from '../vscode';
import { markStart, OUT, paymentsSite, SIZE } from './shared';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';


const scene = (name: string) => ({ recordDir: join(OUT, name), windowSize: SIZE, folder: paymentsSite() });

async function openSidebar(page: Page) {
  await expect(techdocsIcon(page)).toBeVisible({ timeout: 60_000 });
  await clickLike(page, techdocsIcon(page));
  await expect(treeRow(page, 'Home')).toBeVisible({ timeout: 30_000 });
}

/** Clica no fim do último bloco de texto da página (parágrafo ou título) e começa uma linha nova. */
async function newLineAtEnd(page: Page, editor: FrameLocator) {
  const last = editor.locator('.ProseMirror > :is(p, h1, h2, h3)').last();
  await clickLike(page, last);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
}

test.describe('install', () => {
  test.use({ ...scene('install'), devExtension: false });
  test('instalar pelo Marketplace', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await page.locator('.activitybar').waitFor();
    await pause(page, 1_000);
    markStart('install', startedAt);
    await caption(page, 'Open the Extensions view and search for TechDocs Editor');
    await clickLike(page, page.locator('.activitybar .action-item a[aria-label^="Extensions"]'));
    const search = page.locator('.extensions-viewlet .suggest-input-container');
    await search.waitFor();
    await clickLike(page, search);
    await typeSlowly(page, 'TechDocs Editor edtroleis');
    const result = page.locator('.extensions-list .monaco-list-row', { hasText: 'TechDocs Editor' }).first();
    await result.waitFor({ timeout: 60_000 });
    await pause(page, 1_200);
    await clickLike(page, result);
    await pause(page, 1_500);
    await caption(page, 'Install');
    await clickLike(page, page.locator('.extension-editor .header').getByRole('button', { name: 'Install', exact: true }).first());
    // Primeira extensão do publisher: o VS Code pergunta se confia nele
    const trust = page.locator('.monaco-dialog-box').getByRole('button', { name: /Trust Publisher/ });
    if (await trust.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await clickLike(page, trust);
    await caption(page, 'The TechDocs icon shows up in the activity bar');
    await openSidebar(page);
    await pause(page, 2_500);
  });
});

test.describe('sidebar', () => {
  test.use(scene('sidebar'));
  test('a árvore da documentação', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    markStart('sidebar', startedAt);
    await caption(page, 'The TechDocs icon shows your documentation');
    await openSidebar(page);
    await expandRow(page, treeRow(page, 'Guides'));
    await expandRow(page, treeRow(page, 'Reference'));
    await caption(page, 'The pages in the order of the site menu, with their titles');
    await pause(page, 2_500);
    await caption(page, '⚠ marks pages with formatting problems, even closed ones, and their section');
    await expect(treeRow(page, 'Deploy').locator('.codicon-warning')).toBeVisible({ timeout: 15_000 });
    await treeRow(page, 'Deploy').hover();
    await pause(page, 3_000);
    await caption(page, 'Right-click to rename, duplicate, move or delete, with Undo');
    await treeRow(page, 'Getting started').click({ button: 'right' });
    await pause(page, 2_500);
    await page.keyboard.press('Escape');
    await caption(page, 'A click opens the page in the visual editor');
    await openFromTree(page, 'Getting started');
    await pause(page, 2_500);
  });
});

test.describe('blank-page', () => {
  test.use(scene('blank-page'));
  test('página em branco numa seção', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await openSidebar(page);
    markStart('blank-page', startedAt);
    await expandRow(page, treeRow(page, 'Guides'));
    await caption(page, 'A new page right in the section, from the tree');
    await contextMenu(page, treeRow(page, 'Guides'), 'New Page in This Section');
    await caption(page, 'Start from a blank page…');
    await pause(page, 1_200);
    await pick(page, 'Blank page');
    await caption(page, '…give it a title: the file name follows');
    await answer(page, 'Roll back', /Title of the new page/);
    await pause(page, 600);
    await answer(page, undefined, /File of the new page/);
    const nav = quickInput(page).locator('.monaco-list-row', { hasText: 'Add to the nav' });
    if (await nav.first().waitFor({ timeout: 2_000 }).then(() => true, () => false)) await pick(page, 'Add to the nav');
    await expect(page.locator('.tab.active')).toContainText('roll-back.md', { timeout: 30_000 });
    const editor = await editorOf(page);
    await caption(page, 'It opens in the visual editor, already in the site menu');
    await newLineAtEnd(page, editor);
    await typeSlowly(page, 'Deploy the previous version from the pipeline, then check the health page.');
    await page.keyboard.press('Control+S');
    await expect(treeRow(page, 'Roll back')).toBeVisible();
    await pause(page, 2_500);
  });
});

test.describe('new-page', () => {
  test.use(scene('new-page'));
  test('página a partir de um template', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await openSidebar(page);
    markStart('new-page', startedAt);
    await expandRow(page, treeRow(page, 'Guides'));
    await caption(page, 'Or start from a template, with the sections each kind of page needs');
    await contextMenu(page, treeRow(page, 'Guides'), 'New page from template');
    await expect(quickInput(page)).toBeVisible();
    await pause(page, 2_000);
    await pick(page, 'Runbook', 'runbook');
    await caption(page, 'Title, and the questions of the template');
    await answer(page, 'Card provider down', /Title/);
    // O arquivo como vem; o alerta (pergunta do template); o resto como vem
    await pause(page, 600);
    await answer(page, undefined, /File of the new page/);
    await pause(page, 600);
    await answer(page, 'PaymentProviderTimeouts', /Alert/);
    // O lugar no menu: a seção clicada já vem escolhida
    for (let i = 0; i < 5 && (await quickInput(page).isVisible()); i++) {
      await pause(page, 1_200);
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('.tab.active')).toContainText('card-provider-down.md', { timeout: 30_000 });
    await editorOf(page);
    await caption(page, 'It opens with the first part to fill selected: just type');
    await pause(page, 1_500);
    await typeSlowly(page, 'Checkout payments fail with a timeout from the card provider.');
    await pause(page, 1_200);
    await page.keyboard.press('Control+S');
    await caption(page, 'Saved in docs/guides, and in the menu');
    await pause(page, 2_500);
  });
});

test.describe('visual-editor', () => {
  test.use(scene('visual-editor'));
  test('editar no visual, com o texto ao lado', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await openSidebar(page);
    markStart('visual-editor', startedAt);
    await expandRow(page, treeRow(page, 'Guides'));
    const editor = await openFromTree(page, 'Getting started');
    await caption(page, 'Edit like a document: no Markdown needed');
    await newLineAtEnd(page, editor);
    await typeSlowly(page, 'To stop it, press ');
    await page.keyboard.press('Control+B');
    await typeSlowly(page, 'Ctrl+C');
    await page.keyboard.press('Control+B');
    await typeSlowly(page, ' in the terminal.');
    await pause(page, 1_000);
    await caption(page, 'Type / to insert lists, tables, images, code and diagrams');
    await page.keyboard.press('Enter');
    await typeSlowly(page, '/bullet');
    await pause(page, 1_200);
    await page.keyboard.press('Enter');
    await typeSlowly(page, 'Logs go to the console');
    await page.keyboard.press('Enter');
    await typeSlowly(page, 'Metrics answer on /metrics');
    await pause(page, 1_000);
    await caption(page, 'The Markdown text side by side: both follow each other');
    await runCommand(page, 'TechDocs: Open as Markdown text');
    await pause(page, 3_000);
    await page.keyboard.press('Control+S');
    await caption(page, 'Ctrl+S saves only what you changed');
    await pause(page, 2_000);
  });
});

test.describe('mermaid', () => {
  test.use(scene('mermaid'));
  test('diagrama Mermaid', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await openSidebar(page);
    markStart('mermaid', startedAt);
    const editor = await openFromTree(page, 'Home', 'Payments Service');
    await caption(page, 'Diagrams with Mermaid: / and Diagram (Mermaid)');
    await newLineAtEnd(page, editor);
    await typeSlowly(page, '/diag');
    await pause(page, 800);
    await clickLike(page, editor.locator('.milkdown-slash-menu li', { hasText: /^Diagram \(Mermaid\)$/ }));
    const block = editor.locator('.milkdown-code-block').last();
    await expect(block.locator('.mermaid-diagram svg')).toBeVisible({ timeout: 20_000 });
    await caption(page, 'Drawn in place, in the colors of your theme');
    await expect(toast(page, /Configured Mermaid diagrams/)).toBeVisible();
    await pause(page, 2_500);
    await caption(page, 'The site is set up to draw it too (mkdocs.yml, with Undo)');
    await pause(page, 2_500);
    await caption(page, 'Edit the code: the diagram follows');
    await block.hover();
    await clickLike(page, block.getByText('Edit', { exact: true }));
    const code = block.locator('.cm-content');
    await expect(code).toBeVisible();
    await clickLike(page, code.getByText('B --> C[End]'));
    await page.keyboard.press('End');
    await typeSlowly(page, '\n  C --> D[Receipt sent]');
    await expect(block.locator('.mermaid-diagram svg')).toContainText('Receipt sent', { timeout: 15_000 });
    await pause(page, 2_500);
    await page.keyboard.press('Control+S');
    await pause(page, 800);
  });
});

test.describe('lint-and-fix', () => {
  test.use(scene('lint-and-fix'));
  test('problemas de formatação e Ajustar agora', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await openSidebar(page);
    markStart('lint-and-fix', startedAt);
    await expandRow(page, treeRow(page, 'Guides'));
    await caption(page, 'Deploy has formatting problems that would fail the pipeline');
    await expect(treeRow(page, 'Deploy').locator('.codicon-warning')).toBeVisible({ timeout: 15_000 });
    const editor = await openFromTree(page, 'Deploy');
    const problems = editor.locator('.problems');
    await expect(problems).toBeVisible();
    await caption(page, 'The page lists them in plain language', 'top');
    await clickLike(page, problems.locator('summary'));
    await pause(page, 3_000);
    await caption(page, 'One click fixes what can be fixed automatically', 'top');
    await clickLike(page, problems.getByRole('button', { name: 'Fix automatically' }));
    await expect(problems).toHaveCount(0);
    await page.keyboard.press('Control+S');
    await caption(page, 'The ⚠ goes away from the page and its section');
    await expect(treeRow(page, 'Deploy').locator('.codicon-warning')).toHaveCount(0, { timeout: 15_000 });
    await pause(page, 2_500);
  });
});

test.describe('new-site', () => {
  // Um repositório só com o README e o código: ainda sem documentação
  const repo = () => {
    const folder = paymentsSite();
    rmSync(join(folder, 'docs'), { recursive: true, force: true });
    for (const file of ['mkdocs.yml', 'catalog-info.yaml', '.markdownlint.yaml']) rmSync(join(folder, file), { force: true });
    writeFileSync(join(folder, 'README.md'), '# Payments Service\n\nCharges the checkout: authorizes the card and records the payment.\n\n## Run it\n\n```bash\nmake run\n```\n');
    mkdirSync(join(folder, 'src'));
    writeFileSync(join(folder, 'src/app.py'), 'def charge(cart):\n    ...\n');
    return folder;
  };
  test.use({ recordDir: join(OUT, 'new-site'), windowSize: SIZE, folder: repo() });
  test('documentação nova a partir do README, pelo painel de prévia', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    markStart('new-site', startedAt);
    await caption(page, 'A repository with code and a README, but no docs yet');
    await clickLike(page, techdocsIcon(page));
    const prepare = page.getByRole('button', { name: 'Prepare the documentation' });
    await prepare.waitFor();
    await pause(page, 1_800);
    await clickLike(page, prepare);
    const panel = await previewPanel(page);
    await expect(panel.locator('#f-siteName')).toHaveValue('Payments Service');
    await caption(page, 'A preview first: name and description come from the README');
    await pause(page, 2_500);
    await caption(page, 'Pick a template: the pages come with it');
    await clickLike(page, panel.locator('#f-template'));
    await panel.locator('#f-template').selectOption({ label: 'Service docs' });
    await pause(page, 2_500);
    await caption(page, '+ Page adds more, with the kind of page');
    await clickLike(page, panel.getByRole('button', { name: '+ Page' }));
    await typeSlowly(page, 'Run locally');
    const kinds = await panel.locator('#add-type option').allTextContents();
    await panel.locator('#add-type').selectOption({ label: kinds.find(k => /How-to/.test(k))! });
    await page.keyboard.press('Enter');
    await pause(page, 2_000);
    await caption(page, 'Create writes mkdocs.yml, the menu and the pages, ready for TechDocs');
    await clickLike(page, panel.getByRole('button', { name: 'Create' }));
    await expect(page.locator('.tab.active')).toContainText('index.md', { timeout: 30_000 });
    await expect(treeRow(page, 'Run locally')).toBeVisible({ timeout: 15_000 });
    await pause(page, 3_000);
  });
});
