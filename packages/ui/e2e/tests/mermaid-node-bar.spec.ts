import { expect, Page, test } from '@playwright/test';
import { openEditor, saved } from './helpers';

/** Barra do nó no fluxograma (spec 06, M12–M16). */

const page1 = (code: string) => `# Página\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`;
const FLOW = 'flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Fim]';
const flow = page1(FLOW);
const block = (page: Page) => page.locator('.milkdown-code-block').first();
const node = (page: Page, text: string) => block(page).locator('.mermaid-diagram g.node', { hasText: text });
const bar = (page: Page) => page.locator('.mermaid-node-bar');
const button = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true });
const hint = (page: Page) => block(page).locator('.mermaid-hint');
const HINT = 'Clique num nó para acrescentar ou ligar; clique duas vezes num texto para editá-lo';

test('clique num nó do fluxograma mostra a barra; + Passo depois abre o código no nome novo', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Fim').click();
  await expect(bar(page)).toBeVisible();
  await button(page, '+ Passo depois').click();
  await expect(bar(page)).toBeHidden();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Novo passo');
  await page.keyboard.type('Enviar');
  await expect.poll(() => saved(page)).toBe(page1(`${FLOW}\n  C --> N1[Enviar]`));
});

test('+ Decisão saindo de decisão leva Não (a 1ª seta já existe); Ctrl+Z desfaz de uma vez', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Decisão').click();
  await button(page, '+ Decisão').click();
  await expect.poll(() => saved(page)).toBe(page1(`${FLOW}\n  B -- Não --> N1{Nova decisão?}`));
  await page.keyboard.press('Control+z');
  await expect.poll(() => saved(page)).toBe(flow);
});

test('Ligar a… liga ao nó clicado em seguida, com a dica trocada', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Início').click();
  await button(page, 'Ligar a…').click();
  await expect(bar(page)).toBeHidden();
  await expect(hint(page)).toHaveText('Clique no nó de destino (Esc cancela)');
  await node(page, 'Fim').click();
  await expect.poll(() => saved(page)).toBe(page1(`${FLOW}\n  A --> C`));
  await expect(hint(page)).toHaveText(HINT);
  await expect(block(page).locator('.codemirror-host')).toHaveClass(/hidden/);
});

test('Ligar a… com Esc cancela', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Início').click();
  await button(page, 'Ligar a…').click();
  await expect(hint(page)).toHaveText('Clique no nó de destino (Esc cancela)');
  await page.keyboard.press('Escape');
  await expect(hint(page)).toHaveText(HINT);
  await node(page, 'Fim').click();
  await expect(bar(page)).toBeVisible();
  expect(await saved(page)).toBeUndefined();
});

test('Apagar tira o nó e as setas dele', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Fim').click();
  await button(page, 'Apagar').click();
  await expect.poll(() => saved(page)).toBe(page1('flowchart LR\n  A[Início] --> B{Decisão}'));
  await expect(block(page).locator('.codemirror-host')).toHaveClass(/hidden/);
});

test('linha com & : a mensagem aparece e nada muda', async ({ page }) => {
  await openEditor(page, page1('flowchart LR\n  A & B --> C'));
  await node(page, 'C').click();
  await button(page, 'Apagar').click();
  await expect(hint(page)).toHaveText('Não deu para mudar o diagrama automaticamente; edite o código');
  expect(await saved(page)).toBeUndefined();
});

test('clique duplo fecha a barra e abre o código', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Decisão').getByText('Decisão', { exact: true }).dblclick();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await expect(bar(page)).toBeHidden();
});

test('clique fora fecha a barra; Esc também', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Fim').click();
  await expect(bar(page)).toBeVisible();
  await page.locator('.milkdown h1').click();
  await expect(bar(page)).toBeHidden();
  await node(page, 'Fim').click();
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar(page)).toBeHidden();
});

test('sequência e modo leitura: sem barra', async ({ page }) => {
  await openEditor(page, page1('sequenceDiagram\n  A->>B: oi'));
  await block(page).locator('.mermaid-diagram svg').getByText('oi').click();
  await page.waitForTimeout(300);
  await expect(bar(page)).toBeHidden();
  await page.goto(`/?readonly=1&md=${encodeURIComponent(flow)}`);
  await node(page, 'Fim').click();
  await page.waitForTimeout(300);
  await expect(bar(page)).toBeHidden();
});

test('digitar no código redesenha e fecha a barra', async ({ page }) => {
  await openEditor(page, flow);
  await block(page).hover();
  await block(page).getByText('Editar').click();
  await block(page).locator('.cm-content').getByText('C[Fim]').click();
  await node(page, 'Fim').click();
  await expect(bar(page)).toBeVisible();
  await block(page).locator('.cm-content').getByText('C[Fim]').click();
  await page.keyboard.press('End');
  await page.keyboard.type('x');
  await expect(bar(page)).toBeHidden();
});

test('modo leitura ligado com a barra aberta: a barra fecha e nada muda', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Fim').click();
  await expect(bar(page)).toBeVisible();
  await page.evaluate(() => window.harness.setReadOnly(true));
  await expect(bar(page)).toBeHidden();
  expect(await saved(page)).toBeUndefined();
});

test('modo leitura ligado no modo Ligar: o clique no destino não liga', async ({ page }) => {
  await openEditor(page, flow);
  await node(page, 'Início').click();
  await button(page, 'Ligar a…').click();
  await page.evaluate(() => window.harness.setReadOnly(true));
  await node(page, 'Fim').click();
  await page.waitForTimeout(500);
  expect(await saved(page)).toBeUndefined();
});

test('Ligar a… logo depois da mensagem de erro: a dica do Ligar fica, sem o vermelho', async ({ page }) => {
  await openEditor(page, page1('flowchart LR\n  A & B --> C'));
  await node(page, 'C').click();
  await button(page, 'Apagar').click();
  await expect(hint(page)).toHaveClass(/mermaid-hint-error/);
  await node(page, 'C').click();
  await button(page, 'Ligar a…').click();
  await expect(hint(page)).toHaveText('Clique no nó de destino (Esc cancela)');
  await expect(hint(page)).not.toHaveClass(/mermaid-hint-error/);
  // O tempo da mensagem de erro (6 s) passa e a dica do Ligar continua
  await page.waitForTimeout(6_500);
  await expect(hint(page)).toHaveText('Clique no nó de destino (Esc cancela)');
});
