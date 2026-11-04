import { expect, Page, test } from '@playwright/test';
import { editor, openEditor, saved } from './helpers';

/** Diagramas Mermaid no editor visual (spec 06, M1–M3). */

const page1 = (code: string) => `# Página\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`;
const block = (page: Page) => page.locator('.milkdown-code-block').first();

test('o bloco mermaid aparece desenhado e o Markdown não muda', async ({ page }) => {
  const { errors } = await openEditor(page, page1('flowchart LR\n  A-->B'));
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  // Abrir e desenhar não é edição
  expect(await saved(page)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Editar mostra o código; mudar o código redesenha', async ({ page }) => {
  await openEditor(page, page1('flowchart LR\n  A-->B'));
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  await block(page).hover();
  await block(page).getByText('Editar').click();
  const code = block(page).locator('.cm-content');
  await expect(code).toBeVisible();
  await code.getByText('A-->B').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('Cnovo');
  await expect(block(page).locator('.mermaid-diagram svg')).toContainText('Cnovo');
  expect(await saved(page)).toBe(page1('flowchart LR\n  A-->Cnovo'));
});

test('erro de sintaxe: a mensagem no lugar do diagrama, sem nada solto na página', async ({ page }) => {
  await openEditor(page, page1('flowchart LR\n  A-->'));
  const error = block(page).locator('.mermaid-error');
  await expect(error).toContainText('Erro no diagrama (linha 2)');
  // O Mermaid desenha uma "bomba" de erro no body quando falha ao desenhar: não pode aparecer
  await page.waitForTimeout(300);
  await expect(page.locator('body > div[id^="d"], body > svg')).toHaveCount(0);
  expect(await saved(page)).toBeUndefined();
});

test('bloco vazio não mostra erro', async ({ page }) => {
  await openEditor(page, '# Página\n\n```mermaid\n```\n');
  await page.waitForTimeout(500);
  await expect(block(page).locator('.mermaid-error')).toHaveCount(0);
});

test('link javascript: no diagrama não vira script', async ({ page }) => {
  await openEditor(page, page1('flowchart LR\n  A-->B\n  click A "javascript:alert(1)"'));
  const svg = block(page).locator('.mermaid-diagram svg');
  await expect(svg).toBeVisible();
  const html = await svg.evaluate(el => el.outerHTML);
  expect(html).not.toContain('<script');
  expect(html).not.toMatch(/href="javascript:/i);
});

test('página com 20 diagramas: digitar no fim continua rápido', async ({ page }) => {
  const many = Array.from({ length: 20 }, (_, i) => `\`\`\`mermaid\nflowchart LR\n  A${i}-->B${i}\n\`\`\`\n`).join('\n');
  await openEditor(page, `# Página\n\n${many}\nFim.\n`);
  await editor(page).locator('p', { hasText: 'Fim.' }).click();
  await page.keyboard.press('End');
  const start = Date.now();
  await page.keyboard.type(' Mais');
  await expect(editor(page).locator('p', { hasText: 'Fim. Mais' })).toBeVisible({ timeout: 2000 });
  expect(Date.now() - start).toBeLessThan(2000);
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(20, { timeout: 15000 });
});
