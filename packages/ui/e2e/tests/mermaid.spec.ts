import { expect, Page, test } from '@playwright/test';
import { DIAGRAM_TEMPLATES } from '../../src/diagramTemplates';
import { en } from '../../src/messages/en';
import { ptBR } from '../../src/messages/pt-BR';
import { clickTopBar, editor, newLineAtEnd, openEditor, saved, slash, topBarButton, expectSaved } from './helpers';

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
  // O Crepe só monta os blocos de código perto da área visível: o do fim (na tela) e o primeiro, ao rolar até ele
  const blocks = page.locator('.milkdown-code-block');
  await expect(blocks.last().locator('.mermaid-diagram svg')).toContainText('B19', { timeout: 10000 });
  await blocks.first().scrollIntoViewIfNeeded();
  await expect(blocks.first().locator('.mermaid-diagram svg')).toContainText('B0', { timeout: 10000 });
});

/** Inserir diagrama (spec 06, M4): o exemplo entra como bloco `mermaid` e aparece desenhado. */
const SAMPLE = '```mermaid\nflowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Fim]\n```\n';

test('menu /: "Diagrama: fluxograma" insere o exemplo', async ({ page }) => {
  await openEditor(page);
  await newLineAtEnd(page);
  await slash(page, 'Diagrama: fluxograma');
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  expect(await saved(page)).toBe(`# Página\n\nTexto inicial.\n\n${SAMPLE}`);
});

// Os modelos do menu / (M11, M21), nas duas línguas: cada exemplo desenha sem erro
const MODELS = DIAGRAM_TEMPLATES.map(t => t.name);
const sampleKey = (m: string) => (m === 'Flow' ? 'editorText.diagramSample' : `editorText.diagramSample${m}`);
for (const [lang, messages] of [['', ptBR], ['en', en]] as const) {
  for (const model of MODELS) {
    const name = (messages as Record<string, string>)[`editorText.diagram${model}`];
    test(`menu / (${lang || 'pt-BR'}): ${name} desenha o exemplo`, async ({ page }) => {
      await page.goto(`/?lang=${lang}&md=${encodeURIComponent('# Página\n\nTexto inicial.\n')}`);
      await editor(page).waitFor();
      await newLineAtEnd(page);
      await slash(page, name);
      // > svg: a arquitetura tem SVGs dentro do desenho (os ícones)
      await expect(block(page).locator('.mermaid-diagram > svg')).toBeVisible();
      await expect(block(page).locator('.mermaid-error')).toHaveCount(0);
      const sample = (messages as Record<string, string>)[sampleKey(model)];
      await expect.poll(() => saved(page)).toContain(sample);
    });
  }
}

// Galeria do botão da barra (M22)
const gallery = (page: Page) => page.locator('.diagram-gallery');
const cards = (page: Page) => gallery(page).locator('.diagram-gallery-card:visible');

test('barra: o botão "Diagrama (Mermaid)" abre a galeria; o cartão escolhido insere o exemplo', async ({ page }) => {
  await openEditor(page);
  await expect(topBarButton(page, 'diagram')).toHaveAttribute('title', 'Diagrama (Mermaid)');
  await newLineAtEnd(page);
  await clickTopBar(page, 'diagram');
  await expect(gallery(page)).toBeVisible();
  await expect(cards(page)).toHaveCount(29);
  // As miniaturas chegam desenhadas
  await expect(gallery(page).locator('[data-key="pie"] .diagram-gallery-thumb svg')).toBeVisible();
  await gallery(page).locator('[data-key="flow"]').click();
  await expect(gallery(page)).toHaveCount(0);
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  await expectSaved(page, `# Página\n\nTexto inicial.\n\n${SAMPLE}`);
});

test('galeria: filtro por grupo, busca sem acento, Enter escolhe e Esc fecha sem mudar nada', async ({ page }) => {
  await openEditor(page);
  await newLineAtEnd(page);
  await clickTopBar(page, 'diagram');
  await gallery(page).getByRole('button', { name: 'Gráficos' }).click();
  await expect(cards(page)).toHaveCount(6);
  await expect(gallery(page).locator('[data-key="treemap"] .diagram-since-chip')).toHaveText('Backstage 11.10+');
  await gallery(page).getByRole('button', { name: 'Todos' }).click();
  await page.keyboard.press('Escape');
  await expect(gallery(page)).toHaveCount(0);
  expect(await saved(page)).toBeUndefined();
  await clickTopBar(page, 'diagram');
  await expect(gallery(page).locator('.diagram-gallery-search')).toBeFocused();
  await page.keyboard.type('grafico');
  await expect(cards(page).locator('.diagram-gallery-name')).toHaveText(['gráfico XY']);
  await page.keyboard.press('Enter');
  await expect(gallery(page)).toHaveCount(0);
  await expect.poll(() => saved(page)).toContain('xychart-beta');
});

test('tipo novo do Mermaid: aviso embaixo do desenho com a versão que o TechDocs precisa', async ({ page }) => {
  await openEditor(page, page1(ptBR['editorText.diagramSampleVenn']));
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  await expect(block(page).locator('.mermaid-warning')).toContainText('Mermaid 11.13 ou mais novo');
});

test('tipo comum: sem aviso', async ({ page }) => {
  await openEditor(page, page1('pie title Pets\n  "Cães" : 3\n  "Gatos" : 2'));
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  await expect(block(page).locator('.mermaid-warning')).toHaveCount(0);
});

// Clique duplo leva ao código (M10)
const flow = page1('flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Fim]');
const label = (page: Page, text: string) => block(page).locator('.mermaid-diagram svg').getByText(text, { exact: true });
const codeHidden = (page: Page) => block(page).locator('.codemirror-host');

test('clique duplo num texto do desenho abre o código com o texto selecionado', async ({ page }) => {
  await openEditor(page, flow);
  await expect(block(page).locator('.mermaid-hint')).toHaveText('Clique ou arraste um nó para acrescentar e ligar; clique duas vezes num texto para editá-lo');
  await label(page, 'Decisão').dblclick();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toContain('cm-content');
  await page.keyboard.type('Pago?');
  await expect.poll(() => saved(page)).toBe(page1('flowchart LR\n  A[Início] --> B{Pago?}\n  B --> C[Fim]'));
});

test('com o código aberto, o clique duplo leva a outra linha; desfazer volta', async ({ page }) => {
  await openEditor(page, flow);
  await label(page, 'Decisão').dblclick();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await label(page, 'Fim').dblclick();
  await page.keyboard.type('Saída');
  await expect.poll(() => saved(page)).toBe(page1('flowchart LR\n  A[Início] --> B{Decisão}\n  B --> C[Saída]'));
  await page.keyboard.press('Control+z');
  await expect.poll(() => saved(page)).toBe(flow);
});

test('com o código aberto, o trecho já está selecionado quando o clique duplo termina', async ({ page }) => {
  // No CI a tecla seguinte chegava antes do próximo quadro de animação e caía no fim do código
  await openEditor(page, flow);
  await label(page, 'Decisão').dblclick();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  const selected = await label(page, 'Fim').evaluate(target => {
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    return window.getSelection()?.toString();
  });
  expect(selected).toBe('Fim');
});

test('texto que não está no código: abre o código com o cursor no início', async ({ page }) => {
  await openEditor(page, page1('pie\n  "Cães" : 1'));
  await label(page, '100%').dblclick();
  await expect(block(page).locator('.cm-content')).toBeVisible();
  await page.keyboard.type('%% x\n');
  await expect.poll(() => saved(page)).toBe(page1('%% x\npie\n  "Cães" : 1'));
});

test('clique simples não abre o código', async ({ page }) => {
  await openEditor(page, flow);
  await label(page, 'Decisão').click();
  await page.waitForTimeout(300);
  await expect(codeHidden(page)).toHaveClass(/hidden/);
});

test('modo leitura: sem dica e o clique duplo não abre o código', async ({ page }) => {
  await page.goto(`/?readonly=1&md=${encodeURIComponent(flow)}`);
  await expect(block(page).locator('.mermaid-diagram svg')).toBeVisible();
  await expect(block(page).locator('.mermaid-hint')).toBeHidden();
  await label(page, 'Decisão').dblclick();
  await page.waitForTimeout(300);
  await expect(codeHidden(page)).toHaveClass(/hidden/);
});

test('bloco mermaid sem o seletor de linguagem; os outros blocos continuam com ele', async ({ page }) => {
  await openEditor(page, `${flow}\n\`\`\`js\nlet a = 1;\n\`\`\`\n\n\`\`\`mermaid\n\`\`\`\n`);
  const blocks = page.locator('.milkdown-code-block');
  await expect(blocks.nth(0).locator('.mermaid-diagram svg')).toBeVisible();
  await blocks.nth(1).hover();
  await expect(blocks.nth(1).locator('.language-button')).toBeVisible();
  await blocks.nth(0).hover();
  await expect(blocks.nth(0).locator('.language-button')).toBeHidden();
  await blocks.nth(2).hover();
  await expect(blocks.nth(2).locator('.language-button')).toBeHidden();
});

test('dica: o fluxograma fala do clique no nó; os outros diagramas, só do clique duplo', async ({ page }) => {
  await openEditor(page, page1('sequenceDiagram\n  A->>B: oi'));
  await expect(block(page).locator('.mermaid-hint')).toHaveText('Clique duas vezes num texto do desenho para editá-lo');
});
