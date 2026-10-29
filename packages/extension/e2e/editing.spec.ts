/**
 * O que uma pessoa faz no editor visual dentro do VS Code, com mouse e teclado de verdade.
 * O conteúdo é conferido no disco depois de salvar (Ctrl+S): é o que vai para o repositório.
 */
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeTabDirty,
  cursorAtEndOfFirstParagraph,
  expect,
  openVisual,
  prose,
  runCommand,
  save,
  test,
  visual,
} from './vscode';

const PAGE = 'wiki/docs/index.md';

/** Posição dos botões na barra fixa do editor (a mesma do plugin, TOP_BAR em ui/e2e). */
const UNDO = 13;
const REDO = 14;

test('abrir no editor visual não deixa a página alterada', async ({ vscode: { page, file } }) => {
  const original = file(PAGE);
  await openVisual(page, PAGE);
  await expect(prose(page).locator('h1').first()).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(activeTabDirty(page)).toHaveCount(0);
  await expect.poll(() => file(PAGE)).toBe(original);
});

test('digitar no visual e salvar com Ctrl+S grava no arquivo', async ({ vscode: { page, file } }) => {
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' Texto novo.');
  await expect(activeTabDirty(page)).toHaveCount(1);
  await save(page);
  await expect.poll(() => file(PAGE)).toContain(' Texto novo.');
});

test('Ctrl+S logo depois de digitar grava tudo e a aba fica limpa', async ({ vscode: { page, file } }) => {
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  // Sem esperar: o aviso do que foi digitado ainda está adiado quando o Ctrl+S chega
  await page.keyboard.type(' Digitado e gravado na hora.');
  await page.keyboard.press('Control+S');
  await expect.poll(() => file(PAGE)).toContain(' Digitado e gravado na hora.');
  await expect(activeTabDirty(page)).toHaveCount(0);
});

test('# no começo de um título faz dele Título 1, em vez de descer um nível', async ({ vscode: { page, file } }) => {
  await openVisual(page, PAGE);
  // "Como editar" é Título 2: com "# " no começo vira Título 1
  await prose(page).locator('h2', { hasText: 'Como editar' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('# ');
  await expect(prose(page).locator('h1', { hasText: 'Como editar' })).toBeVisible();
  // E o Título 1 da página continua Título 1
  await prose(page).locator('h1', { hasText: 'Wiki de Demonstração' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('# ');
  await expect(prose(page).locator('h1', { hasText: 'Wiki de Demonstração' })).toBeVisible();
  await save(page);
  await expect.poll(() => file(PAGE)).toMatch(/^# Wiki de Demonstração\n[\s\S]*\n# Como editar\n/);
});

test('Ctrl+Z dentro do visual desfaz uma vez só, e Ctrl+Y refaz', async ({ vscode: { page, file } }) => {
  const original = file(PAGE);
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' abc');
  // Pausa: o que vem depois é outro passo do desfazer
  await page.waitForTimeout(1_200);
  await page.keyboard.type(' def');
  await page.waitForTimeout(800);
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(800);
  await save(page);
  await expect.poll(() => file(PAGE), { message: 'não desfez' }).not.toContain(' def');
  expect(file(PAGE), 'desfez mais de um passo').toContain(' abc');

  await page.keyboard.press('Control+Y');
  await page.waitForTimeout(800);
  await save(page);
  await expect.poll(() => file(PAGE)).toContain(' abc def');
  await expect.poll(() => file(PAGE).replace(' abc def', '')).toBe(original);
});

test('botões Desfazer e Refazer da barra do visual', async ({ vscode: { page, file } }) => {
  const original = file(PAGE);
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' abc');
  await page.waitForTimeout(800);
  await visual(page).locator('.top-bar-item').nth(UNDO).click();
  await expect(prose(page)).not.toContainText(' abc');
  await page.waitForTimeout(800);
  await save(page);
  await expect.poll(() => file(PAGE)).toBe(original);

  await visual(page).locator('.top-bar-item').nth(REDO).click();
  await expect(prose(page)).toContainText(' abc');
  await page.waitForTimeout(800);
  await save(page);
  await expect.poll(() => file(PAGE)).toContain(' abc');
});

test('com o texto Markdown aberto ao lado, Desfazer e Refazer (barra e teclado) funcionam', async ({
  vscode: { page, file },
}) => {
  const original = file(PAGE);
  await openVisual(page, PAGE);
  await runCommand(page, 'TechDocs: Open as Markdown text');
  const text = page.locator('.monaco-editor .view-lines').last();
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' abc');
  await expect(text).toContainText(' abc');
  await page.waitForTimeout(800);

  await visual(page).locator('.top-bar-item').nth(UNDO).click();
  await expect(prose(page)).not.toContainText(' abc');
  await expect(text).not.toContainText(' abc');
  await visual(page).locator('.top-bar-item').nth(REDO).click();
  await expect(prose(page)).toContainText(' abc');
  await expect(text).toContainText(' abc');

  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.press('Control+Z');
  await expect(prose(page)).not.toContainText(' abc');
  await expect(text).not.toContainText(' abc');
  await page.waitForTimeout(800);
  await prose(page).click();
  await save(page);
  await expect.poll(() => file(PAGE)).toBe(original);
});

test('o que se digita no visual aparece no texto Markdown ao lado', async ({ vscode: { page } }) => {
  await openVisual(page, PAGE);
  await runCommand(page, 'TechDocs: Open as Markdown text');
  await expect(page.locator('.editor-group-container')).toHaveCount(2);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' visto do lado');
  await expect(page.locator('.monaco-editor .view-lines').last()).toContainText('visto do lado');
});

test('o que se digita no texto Markdown aparece no visual', async ({ vscode: { page } }) => {
  await openVisual(page, PAGE);
  await runCommand(page, 'TechDocs: Open as Markdown text');
  const text = page.locator('.monaco-editor .view-lines').last();
  await text.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nLinha escrita no texto.\n');
  await expect(prose(page)).toContainText('Linha escrita no texto.');
});

test('digitar logo depois de criar um item de lista não troca as letras', async ({ vscode: { page, file } }) => {
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('- um');
  await page.keyboard.press('Enter');
  await page.keyboard.type('dois');
  await page.waitForTimeout(800);
  await save(page);
  await expect.poll(() => file(PAGE)).toMatch(/- um\n- dois\n/);
});

test('arquivo com CRLF continua com CRLF depois de editar e salvar', async ({ vscode: { page, file, workspace } }) => {
  // Numa pasta de docs: o comando do editor visual só aparece nas páginas das docs
  copyFileSync(join(workspace, 'crlf/pagina.md'), join(workspace, 'wiki/docs/crlf.md'));
  await openVisual(page, 'wiki/docs/crlf.md');
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' Mais texto.');
  await page.waitForTimeout(800);
  await save(page);
  const saved = file('wiki/docs/crlf.md');
  expect(saved).toContain(' Mais texto.');
  expect(saved).not.toMatch(/[^\r]\n/);
});
