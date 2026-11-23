import { expect, Locator, Page, test } from '@playwright/test';
import { openEditor, saved } from './helpers';

/** Arrastar e soltar no fluxograma (spec 06, M17–M20). */

const page1 = (code: string) => `# Página\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`;
const FLOW = 'flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Fim]';
const flow = page1(FLOW);
const block = (page: Page) => page.locator('.milkdown-code-block').first();
const node = (page: Page, text: string) => block(page).locator('.mermaid-diagram g.node', { hasText: text });
const hint = (page: Page) => block(page).locator('.mermaid-hint');

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Aperta no nó, arrasta em passos até `to` e solta (ou não, com `drop: false`). */
async function drag(page: Page, from: Locator, to: { x: number; y: number }, drop = true) {
  const start = await center(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (drop) await page.mouse.up();
}

test('arrastar de um nó a outro liga os dois', async ({ page }) => {
  await openEditor(page, flow);
  await drag(page, node(page, 'Início'), await center(node(page, 'Fim')));
  await expect.poll(() => saved(page)).toBe(page1(`${FLOW}\n  A --> C`));
  await expect(block(page).locator('.codemirror-host')).toHaveClass(/hidden/);
  await expect(page.locator('.mermaid-node-bar')).toBeHidden();
});

test('arrastar de um nó a um espaço vazio do desenho cria um passo e abre o código no nome', async ({ page }) => {
  await openEditor(page, flow);
  const svg = (await block(page).locator('.mermaid-diagram svg').boundingBox())!;
  const end = await center(node(page, 'Fim'));
  // Abaixo do nó Fim, ainda dentro do diagrama (a dica fica embaixo do SVG)
  await drag(page, node(page, 'Fim'), { x: end.x, y: svg.y + svg.height + 4 });
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Novo passo');
  await page.keyboard.type('Enviar');
  await expect.poll(() => saved(page)).toBe(page1(`${FLOW}\n  C --> N1[Enviar]`));
});

test('durante o arrasto: linha, destino destacado e a dica; Esc cancela', async ({ page }) => {
  await openEditor(page, flow);
  await drag(page, node(page, 'Início'), await center(node(page, 'Fim')), false);
  await expect(page.locator('.mermaid-drag-line')).toBeVisible();
  await expect(node(page, 'Fim')).toHaveClass(/mermaid-drop-target/);
  await expect(hint(page)).toHaveText('Solte num nó para ligar, ou num espaço vazio para criar um passo (Esc cancela)');
  await page.keyboard.press('Escape');
  await expect(page.locator('.mermaid-drag-line')).toHaveCount(0);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await saved(page)).toBeUndefined();
  await expect(hint(page)).toHaveText('Clique ou arraste um nó para acrescentar e ligar; clique duas vezes num texto para editá-lo');
});

test('soltar fora do desenho ou no próprio nó não muda nada', async ({ page }) => {
  await openEditor(page, flow);
  await drag(page, node(page, 'Início'), { x: 5, y: 5 });
  await drag(page, node(page, 'Fim'), await center(node(page, 'Fim')).then(p => ({ x: p.x + 1, y: p.y + 30 })), false);
  await page.mouse.move(...Object.values(await center(node(page, 'Fim'))) as [number, number], { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await saved(page)).toBeUndefined();
});

test('movimento pequeno conta como clique e abre a barra', async ({ page }) => {
  await openEditor(page, flow);
  const p = await center(node(page, 'Fim'));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y + 1);
  await page.mouse.up();
  await expect(page.locator('.mermaid-node-bar')).toBeVisible();
});

test('modo leitura e sequência: arrastar não faz nada', async ({ page }) => {
  await page.goto(`/?readonly=1&md=${encodeURIComponent(flow)}`);
  await expect(node(page, 'Fim')).toBeVisible();
  await drag(page, node(page, 'Início'), await center(node(page, 'Fim')));
  await page.waitForTimeout(300);
  await expect(page.locator('.mermaid-drag-line')).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.saved())).toBeUndefined();
});
