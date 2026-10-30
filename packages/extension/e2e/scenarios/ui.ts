/**
 * Onde as coisas ficam na tela do VS Code com a extensão: a barra lateral TechDocs, a árvore, o painel Nova
 * documentação (um webview na barra lateral) e o editor visual (um webview na área dos editores).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { expect } from '../vscode';
import { click, type } from './story';

export const pane = (page: Page, title: RegExp) => page.locator('.pane', { has: page.locator('.pane-header', { hasText: title }) });
export const docsPane = (page: Page) => pane(page, /^Documentation/i);
export const treeRows = (page: Page) => docsPane(page).locator('.monaco-list-row');
export const treeRow = (page: Page, label: string | RegExp) =>
  treeRows(page).filter({ has: page.locator('.label-name', { hasText: typeof label === 'string' ? new RegExp(`^${label}$`) : label }) }).first();
export const quickInput = (page: Page) => page.locator('.quick-input-widget');
export const techdocsIcon = (page: Page) => page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');

/** Um botão do título da barra lateral TechDocs (aparece com o mouse em cima). */
export async function sidebarAction(page: Page, label: string) {
  await page.locator('.part.sidebar').hover();
  await click(page, page.locator(`.part.sidebar .action-label[aria-label^="${label}"]:visible`).first());
}

/** Botão direito na linha e o item do menu. */
export async function contextMenu(page: Page, row: Locator, item: string | RegExp) {
  await row.click({ button: 'right' });
  const entry = page.locator('.context-view .monaco-menu .action-item', { hasText: item }).first();
  const action = entry.locator('.action-menu-item');
  await expect(action).toBeVisible();
  // O menu só aceita a escolha depois de aberto de vez (o item fica marcado ao passar o mouse). Passa no começo do
  // item: o meio pode cair sobre o editor visual (um webview). O clique às vezes se perde; o Enter no item marcado, não
  const left = { x: 24, y: 10 };
  await expect(async () => {
    await action.hover({ position: left });
    await expect(entry).toHaveClass(/focused/, { timeout: 500 });
  }).toPass();
  await page.keyboard.press('Enter');
  await expect(page.locator('.context-view .monaco-menu')).toHaveCount(0);
}

/** F1, o nome do comando e Enter, como quem procura um comando na paleta. */
export async function palette(page: Page, command: string) {
  // Com o foco no editor visual, o F1 não chega ao VS Code, e o webview pega o foco de volta da paleta: antes, um
  // clique na barra lateral, fora das linhas
  const list = docsPane(page).locator('.monaco-list');
  const box = (await list.boundingBox())!;
  await list.click({ position: { x: box.width / 2, y: box.height - 8 } });
  await page.keyboard.press('F1');
  await expect(quickInput(page).locator('input')).toBeFocused();
  await type(page, command);
  const row = quickInput(page).locator('.monaco-list-row', { hasText: command }).first();
  await expect(row).toBeVisible();
  await click(page, row);
}

/** O webview (o de dentro, com a página) que tem `selector`: o painel da barra lateral ou o editor visual. */
export async function webviewWith(page: Page, selector: string): Promise<FrameLocator> {
  const frames = page.locator('iframe.webview.ready');
  let found: FrameLocator | undefined;
  await expect
    .poll(async () => {
      const count = await frames.count();
      for (let i = 0; i < count; i++) {
        // Abas de trás guardam o webview escondido: só o que está na tela
        if (!(await frames.nth(i).isVisible())) continue;
        const inner = page.frameLocator('iframe.webview.ready').nth(i).frameLocator('iframe#active-frame');
        if ((await inner.locator(selector).count()) > 0) {
          found = inner;
          return true;
        }
      }
      return false;
    }, { message: `webview com ${selector}`, timeout: 30_000 })
    .toBe(true);
  return found!;
}

/** O painel Nova documentação (prévia). */
export const previewPanel = (page: Page) => webviewWith(page, '#f-siteName');

/** O editor visual da aba ativa. */
export const visualEditor = (page: Page) => webviewWith(page, '.milkdown .ProseMirror');

/** Linha da árvore de arquivos/menu do painel Nova documentação. */
export const previewRow = (panel: FrameLocator, text: string | RegExp): Locator => panel.locator('.row', { hasText: text }).first();

/** O editor visual que está na tela. */
export const editorOf = (page: Page) => webviewWith(page, '.milkdown .ProseMirror');

/** Botões da barra fixa do editor visual, na ordem (ui/src/topBar.ts). */
const TOP_BAR = ['bold', 'italic', 'strikethrough', 'inlineCode', 'bulletList', 'orderedList', 'taskList', 'link', 'image', 'table', 'codeBlock', 'quote', 'hr', 'undo', 'redo'] as const;
export const topBar = (editor: FrameLocator, name: (typeof TOP_BAR)[number]) => editor.locator('.top-bar-item').nth(TOP_BAR.indexOf(name));

/** Clica na página da árvore e espera ela abrir no editor visual (com o título 1 `heading`; por padrão, o da árvore). */
export async function openFromTree(page: Page, label: string, heading = label) {
  await click(page, treeRow(page, label));
  let editor!: FrameLocator;
  await expect
    .poll(async () => {
      editor = await editorOf(page);
      return editor.locator('.ProseMirror h1').first().textContent();
    }, { message: `página ${label} no editor visual` })
    .toContain(heading);
  return editor;
}

/** A seção Manutenção (a conferência da documentação). */
export const checkPane = (page: Page) => pane(page, /^Maintenance/i);
export const checkRow = (page: Page, text: string | RegExp) => checkPane(page).locator('.monaco-list-row', { hasText: text }).first();

/** "Corrigir" numa linha da conferência: o diff da correção abre e a pessoa escolhe Aplicar. */
export async function fixFinding(page: Page, row: Locator) {
  await row.hover();
  await click(page, row.locator('.action-label[aria-label="Fix"]'));
  await expect(page.locator('.tab.active')).toContainText('proposed fix');
  const apply = quickInput(page).locator('.monaco-list-row', { hasText: /^Apply/ });
  await expect(apply).toBeVisible();
  await click(page, apply);
  await expect(page.locator('.tab', { hasText: 'proposed fix' })).toHaveCount(0);
  // A pessoa olha o resultado antes de seguir (clicar logo na página criada, ainda no mesmo instante, não a mostra)
  await page.waitForTimeout(1_500);
}

/** Liga uma configuração de caixa de seleção pela tela de Configurações (Ctrl+,), como a pessoa faria; `title` é o nome na tela. */
export async function turnOnSetting(page: Page, id: string, title: string) {
  await page.keyboard.press('Control+,');
  await expect(page.locator('.settings-editor')).toBeVisible();
  await expect(page.locator('.settings-editor .suggest-input-container')).toBeVisible();
  await page.waitForTimeout(500);
  await type(page, id);
  const row = page.locator('.settings-editor .setting-item-bool', { has: page.locator('.setting-item-label', { hasText: title }) });
  const box = row.locator('.setting-value-checkbox');
  await expect(box).toBeVisible();
  await click(page, box);
  await expect(box).toHaveAttribute('aria-checked', 'true');
  // O VS Code grava a configuração um instante depois: fechar a tela antes perde a mudança
  await page.waitForTimeout(1_500);
  await page.keyboard.press('Control+W');
}

/** A faixa de publicação no alto do editor visual. */
export const publishStrip = (editor: FrameLocator) => editor.locator('.status-strip');

/** Ctrl+S e espera a aba ficar sem alteração pendente. */
export async function save(page: Page) {
  await page.keyboard.press('Control+S');
  await expect(page.locator('.tab.active.dirty')).toHaveCount(0);
}

/** A página tem o ⚠ na árvore. */
export const hasWarning = async (page: Page, label: string) => (await treeRow(page, label).locator('.codicon-warning').count()) > 0;

/** "+ Página" no painel Nova documentação: o nome, o tipo de página e Enter. */
export async function addPage(page: Page, panel: FrameLocator, name: string, kind: RegExp) {
  await click(page, panel.getByRole('button', { name: '+ Page' }));
  const input = panel.locator('#add');
  await expect(input).toBeFocused();
  await type(page, name);
  const labels = await panel.locator('#add-type option').allTextContents();
  const label = labels.find(text => kind.test(text));
  expect(label, `tipo de página ${kind} em: ${labels.join(', ')}`).toBeTruthy();
  await panel.locator('#add-type').selectOption({ label: label! });
  await expect(input).toBeFocused();
  await page.keyboard.press('Enter');
}

/**
 * `mkdocs build --strict`, como a pipeline do TechDocs (techdocs-core). O mkdocs vem de MKDOCS, ou do venv do Backstage
 * local (~/code/backstage/.venv); undefined se não há nenhum.
 */
export function buildSite(folder: string): { ok: boolean; output: string } | undefined {
  const mkdocs = process.env.MKDOCS ?? join(homedir(), 'code/backstage/.venv/bin/mkdocs');
  if (!existsSync(mkdocs)) return undefined;
  const out = mkdtempSync(join(tmpdir(), 'cenario-site-'));
  const result = spawnSync(mkdocs, ['build', '--strict', '-d', out], { cwd: folder, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout}\n${result.stderr}`.trim() };
}
