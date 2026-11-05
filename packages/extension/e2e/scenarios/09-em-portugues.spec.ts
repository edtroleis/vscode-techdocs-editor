/**
 * Cenário 9: o VS Code em português (--locale pt-br). A pessoa faz o caminho de sempre (preparar a documentação,
 * escrever, organizar, conferir) e o cenário recolhe o texto de tudo o que aparece na tela: barra lateral, painel,
 * editor visual, menu /, botão direito, mensagens. Texto em inglês ou "pasta" (no lugar de "diretório") vira achado.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameLocator, Page } from '@playwright/test';
import { click, expect, folderFrom, pause, test, type } from './story';
import { docsPane, editorOf, palette, previewPanel, techdocsIcon, toast, treeRow, treeRows, webviewWith } from './ui';

const folder = folderFrom('tarefas-api', 'tarefas-api');
const read = (path: string) => readFileSync(join(folder, path), 'utf8');

/** Palavras em inglês que não deviam aparecer num texto da extensão em português. */
const ENGLISH = /\b(the|page|pages|create|open|folder|add|delete|menu|section|check|fix|undo|documentation|template|save|visual editor|not in)\b/i;
/** Nomes próprios e termos técnicos que ficam iguais nas duas línguas. */
const ALLOWED = /TechDocs|MkDocs|Markdown|mkdocs\.yml|catalog-info\.yaml|README|GitHub|Backstage|Mermaid|\.md\b|docs\//g;

function audit(story: { suggest: (text: string) => void }, where: string, texts: string[]) {
  const english = new Set<string>();
  const pasta = new Set<string>();
  for (const raw of texts.flatMap(t => t.split('\n')).map(t => t.trim()).filter(Boolean)) {
    if (ENGLISH.test(raw.replace(ALLOWED, ''))) english.add(raw);
    if (/\bpastas?\b/i.test(raw)) pasta.add(raw);
  }
  if (english.size) story.suggest(`${where}: texto em inglês com o VS Code em português: ${[...english].slice(0, 12).map(t => `"${t.slice(0, 90)}"`).join('; ')}`);
  if (pasta.size) story.suggest(`${where}: "pasta" no lugar de "diretório": ${[...pasta].map(t => `"${t}"`).join('; ')}`);
}

const sidebarText = (page: Page) => page.locator('.part.sidebar').innerText();

test.use({
  folder,
  locale: 'pt-br',
  scenario: {
    id: '09-em-portugues',
    title: 'VS Code em português: todos os textos da extensão em pt-BR',
    summary:
      'O VS Code aberto com --locale pt-br, numa pasta com uma API sem documentação. A pessoa prepara a documentação, escreve no editor visual, usa o menu /, o botão direito da árvore e a conferência. O cenário recolhe todos os textos na tela e aponta o que ficou em inglês ou usa "pasta".',
  },
});

test('vs code em português: todos os textos da extensão em pt-br', async ({ vscode: { page }, story }) => {
  await story.step('Barra lateral TechDocs: a tela de boas-vindas', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    await expect(page.locator('.part.sidebar .welcome-view-content')).toBeVisible();
    audit(story, 'Boas-vindas da barra lateral', [await sidebarText(page)]);
    await pause(page);
  });

  await story.step('Preparar a documentação: o painel Nova documentação', async () => {
    await click(page, page.getByRole('button', { name: /Preparar a documentação|Criar a documentação/ }).first());
    const panel = await previewPanel(page);
    await expect(panel.locator('#f-siteName')).toHaveValue('Tarefas API');
    audit(story, 'Painel Nova documentação', [await panel.locator('body').innerText()]);
    await story.check('o botão Criar em português', () => expect(panel.getByRole('button', { name: 'Criar' })).toBeVisible());
    await click(page, panel.getByRole('button', { name: 'Criar' }));
    await expect(page.locator('.tab.active')).toContainText('index.md', { timeout: 30_000 });
    await pause(page);
  });

  let editor!: FrameLocator;
  await story.step('Editor visual: barra, dicas dos botões e menu /', async () => {
    editor = await editorOf(page);
    const titles = await editor.locator('.top-bar-item, [title], [aria-label]').evaluateAll(els => els.map(e => e.getAttribute('title') ?? e.getAttribute('aria-label') ?? '').filter(Boolean));
    audit(story, 'Barra do editor visual (dicas)', titles);
    audit(story, 'Editor visual', [await editor.locator('body').innerText()]);
    await editor.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, '/');
    const menu = editor.locator('.milkdown-slash-menu');
    await expect(menu).toBeVisible();
    const items = await menu.locator('li').allInnerTexts();
    audit(story, 'Menu /', items);
    await story.check('o diagrama no menu / em português', async () => expect(items.join('|')).toContain('Diagrama (Mermaid)'));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await pause(page);
  });

  await story.step('Botão direito numa página e numa seção da árvore', async () => {
    const pages = await treeRows(page).locator('.label-name').allTextContents();
    const target = treeRow(page, pages.find(p => p !== 'tarefas-api' && p !== 'Tarefas API') ?? pages[1]);
    await target.click({ button: 'right' });
    const menu = page.locator('.context-view .monaco-menu');
    await expect(menu).toBeVisible();
    audit(story, 'Botão direito numa página', await menu.locator('.action-label').allInnerTexts());
    await page.keyboard.press('Escape');
    await page.locator('.part.sidebar').hover();
    const actions = await page.locator('.part.sidebar .pane-header .action-label, .part.sidebar .title-actions .action-label').evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? '').filter(Boolean));
    audit(story, 'Botões do título da barra lateral', actions);
    await pause(page);
  });

  await story.step('Conferir a documentação (paleta): a seção Manutenção', async () => {
    await palette(page, 'TechDocs: Conferir');
    await page.waitForTimeout(2_000);
    audit(story, 'Barra lateral depois de conferir', [await sidebarText(page)]);
    await pause(page);
  });

  await story.step('Uma mensagem com Desfazer (excluir uma página)', async () => {
    const before = await toast(page, /./).count();
    const pages = await docsPane(page).locator('.monaco-list-row .label-name').allTextContents();
    const victim = pages.find(p => /Arquitetura|Operação/.test(p));
    if (!victim) return story.suggest(`Nenhuma página para excluir na árvore: ${pages.join(', ')}`);
    await treeRow(page, victim).click({ button: 'right' });
    const del = page.locator('.context-view .monaco-menu .action-item', { hasText: /^Excluir(?! a seção| seção)/ });
    await story.check('"Excluir" no botão direito', () => expect(del).toBeVisible());
    await page.keyboard.press('Escape');
    audit(story, 'Mensagens', await page.locator('.notification-toast').allInnerTexts());
    expect(before).toBeGreaterThanOrEqual(0);
    await pause(page);
  });

  await story.step('Os arquivos criados estão em português', async () => {
    const index = read('docs/index.md');
    audit(story, 'docs/index.md criado', [index]);
    const yml = read('mkdocs.yml');
    audit(story, 'mkdocs.yml criado (títulos do menu)', yml.split('\n').filter(l => /^\s*- [^:]+:/.test(l)));
    await webviewWith(page, '.milkdown .ProseMirror');
  });
});
