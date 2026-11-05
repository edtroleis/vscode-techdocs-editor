/**
 * Vídeos curtos do README, gravados no VS Code de verdade. Cada teste grava um vídeo (webm) na sua
 * pasta; scripts/make-videos.mjs corta o começo (a abertura do VS Code) e converte em GIF.
 */
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { cursorToEnd } from '../../test/webview/editing';
import { caption, clickLike, overlay, pause, typeSlowly } from '../human';
import { expect, openFile, openVisualCommand, prose, runCommand, test, visual } from '../vscode';
import { markStart, OUT, SIZE } from './shared';

// A seção Manutenção aparece só para quem mantém a documentação
const scene = (name: string) => ({ recordDir: join(OUT, name), windowSize: SIZE, settings: { 'techdocsEditor.maintainer': true } });

const pane = (page: Page, title: RegExp) => page.locator('.pane', { has: page.locator('.pane-header', { hasText: title }) });
const docsView = (page: Page) => pane(page, /^Documentation/i);
const checkView = (page: Page) => pane(page, /^Maintenance/i);

/** O ícone TechDocs na barra de atividades, clicado como uma pessoa. */
async function openSidebar(page: Page) {
  const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
  await expect(icon).toBeVisible({ timeout: 30_000 });
  await clickLike(page, icon);
  await expect(docsView(page).locator('.pane-header')).toBeVisible();
}

/** Botão de um item de árvore (só aparece com o mouse em cima). */
async function rowAction(page: Page, row: Locator, label: string) {
  await row.hover();
  await clickLike(page, row.locator(`.action-label[aria-label^="${label}"]`));
}

const quickInput = (page: Page) => page.locator('.quick-input-widget input');

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
