/**
 * Cenário 6: o Checkout, um site MkDocs local sem diagramas. A pessoa desenha o fluxo do pedido com o Mermaid pelo
 * editor visual: insere pelo menu /, desfaz a configuração automática para ver o que acontece, erra a sintaxe, vê o
 * erro no painel Problemas, corrige, e confere que o site gera com o diagrama.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameLocator, Page } from '@playwright/test';
import { click, expect, folderFrom, pause, test, type } from './story';
import { buildSite, openFromTree, palette, save, sidebarAction, techdocsIcon, toast, topBar } from './ui';

const folder = folderFrom('site-diagramas', 'checkout');
const read = (path: string) => readFileSync(join(folder, path), 'utf8');
const diagrams = (editor: FrameLocator) => editor.locator('.milkdown-code-block');
const problems = (page: Page) => page.locator('.markers-panel .monaco-list-row');

test.use({
  folder,
  scenario: {
    id: '06-diagramas-mermaid',
    title: 'Diagramas Mermaid: desenhar o fluxo do pedido',
    summary:
      'O Checkout, um site MkDocs local sem diagramas. A pessoa insere um diagrama pelo menu /, desfaz a configuração automática do mkdocs.yml e refaz pelo Conferir, edita o código, erra a sintaxe e vê o erro no painel Problemas, insere um segundo diagrama pela barra e confere que o site gera.',
  },
});

test('diagramas mermaid: desenhar o fluxo do pedido', async ({ vscode: { page }, story }) => {
  let editor!: FrameLocator;

  await story.step('Abrir "Fluxo do pedido" no editor visual', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    editor = await openFromTree(page, 'Fluxo do pedido');
    await pause(page);
  });

  await story.step('No fim da página, "/" e "Diagram (Mermaid)": o exemplo aparece desenhado', async () => {
    await editor.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, '/');
    const item = editor.locator('.milkdown-slash-menu li', { hasText: /^Diagram \(Mermaid\)$/ });
    await story.check('"Diagram (Mermaid)" no menu /', () => expect(item).toBeVisible());
    await click(page, item);
    await expect(diagrams(editor).first().locator('.mermaid-diagram svg')).toBeVisible({ timeout: 20_000 });
    await story.check('o exemplo tem as três caixas', () => expect(diagrams(editor).first().locator('.mermaid-diagram svg')).toContainText(/Start.*Decision.*End/s));
    await pause(page);
  });

  await story.step('A extensão configura o Mermaid no mkdocs.yml e oferece Desfazer', async () => {
    const message = toast(page, /Configured Mermaid diagrams in/);
    await expect(message).toBeVisible();
    await expect.poll(() => read('mkdocs.yml')).toContain('pymdownx.superfences');
    const yaml = read('mkdocs.yml');
    await story.check('a configuração existente (admonition, techdocs-core) continua', async () => {
      expect(yaml).toContain('- admonition');
      expect(yaml).toContain('- techdocs-core');
    });
    await story.check('a tag !!python/name foi gravada como está', async () => expect(yaml).toContain('format: !!python/name:pymdownx.superfences.fence_code_format'));
    await pause(page);
    await click(page, message.locator('.monaco-button', { hasText: 'Undo' }));
    await expect.poll(() => read('mkdocs.yml')).not.toContain('pymdownx.superfences');
    await pause(page);
  });

  await story.step('Editar o código do diagrama: o desenho acompanha', async () => {
    const block = diagrams(editor).first();
    await block.hover();
    await click(page, block.getByText('Edit', { exact: true }));
    const code = block.locator('.cm-content');
    await expect(code).toBeVisible();
    await code.getByText('B --> C[End]').click();
    await page.keyboard.press('End');
    await type(page, '\n  C --> D[Confirmation email]');
    await expect(block.locator('.mermaid-diagram svg')).toContainText('Confirmation email', { timeout: 15_000 });
    await pause(page);
  });

  await story.step('Errar a sintaxe: a mensagem aparece no bloco e no painel Problemas', async () => {
    const block = diagrams(editor).first();
    await type(page, '\n  D -->');
    await expect(block.locator('.mermaid-error')).toContainText(/Diagram error/, { timeout: 15_000 });
    await save(page);
    await story.check('o arquivo é salvo como está, mesmo com o erro', async () => expect(read('docs/fluxo.md')).toContain('  D -->\n```'));
    await palette(page, 'Problems: Focus on Problems View');
    await story.check('o erro do diagrama no painel Problemas', () => expect(problems(page).filter({ hasText: /Diagram|diagram|Parse error|Expecting/ }).first()).toBeVisible({ timeout: 15_000 }));
    await pause(page, 1_500);
  });

  await story.step('Corrigir o erro: some do bloco e do painel Problemas', async () => {
    const block = diagrams(editor).first();
    await block.locator('.cm-content').getByText('D -->').click();
    await page.keyboard.press('End');
    await type(page, ' E[Done]');
    await expect(block.locator('.mermaid-error')).toHaveCount(0, { timeout: 15_000 });
    await expect(block.locator('.mermaid-diagram svg')).toContainText('Done');
    await save(page);
    await story.check('o painel Problemas fica sem o erro do diagrama', () => expect(problems(page).filter({ hasText: /Diagram|diagram|Parse error|Expecting/ })).toHaveCount(0, { timeout: 15_000 }));
    await pause(page);
  });

  await story.step('Conferir (botão da árvore): avisa que o Mermaid não está configurado, e ajusta', async () => {
    await sidebarAction(page, 'Check the Documentation');
    const message = toast(page, /adjustments/);
    await story.check('a conferência acha um ajuste', () => expect(message).toBeVisible());
    await click(page, message.locator('.monaco-button', { hasText: 'View' }));
    await story.check('o achado do Mermaid no painel Problemas', () => expect(problems(page).filter({ hasText: /Mermaid/ }).first()).toBeVisible());
    await sidebarAction(page, 'Check the Documentation');
    await click(page, toast(page, /adjustments/).locator('.monaco-button', { hasText: 'Fix all automatically' }));
    await expect.poll(() => read('mkdocs.yml')).toContain('pymdownx.superfences');
    await pause(page);
  });

  await story.step('Segundo diagrama pela barra: não mexe de novo no mkdocs.yml', async () => {
    editor = await openFromTree(page, 'Fluxo do pedido');
    const before = read('mkdocs.yml');
    await editor.locator('.ProseMirror h2').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await click(page, topBar(editor, 'mermaid'));
    await expect(diagrams(editor)).toHaveCount(2);
    await save(page);
    await page.waitForTimeout(1_000);
    await story.check('nenhuma mensagem nova de configuração', () => expect(page.locator('.notification-toast', { hasText: /Configured Mermaid/ })).toHaveCount(0));
    expect(read('mkdocs.yml')).toBe(before);
    expect(read('docs/fluxo.md').match(/```mermaid/g)?.length).toBe(2);
    await pause(page);
  });

  await story.step('O site gera com o MkDocs e o diagrama sai como diagrama', async () => {
    const result = buildSite(folder);
    if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
  });
});
