/**
 * Um histórico só (spec 01, W4): Desfazer e Refazer do editor visual (botões e teclado) e do
 * VS Code atuam sobre o mesmo documento, venha a edição do visual ou do texto Markdown ao lado.
 */
import { cursorAtEndOfFirstParagraph, expect, openVisual, prose, runCommand, save, test, visual } from './vscode';

const PAGE = 'wiki/docs/index.md';
const UNDO = 13;
const REDO = 14;

const markdownText = (page: import('@playwright/test').Page) => page.locator('.monaco-editor .view-lines').last();

/**
 * Digita no fim da última linha do texto Markdown ao lado. Uma palavra só (sem espaço nem Enter) é
 * um passo só do desfazer do VS Code.
 */
async function typeInText(page: import('@playwright/test').Page, text: string) {
  await markdownText(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

test('edição feita no texto ao lado é desfeita pelo botão Desfazer do visual', async ({ vscode: { page, file } }) => {
  const original = file(PAGE);
  await openVisual(page, PAGE);
  await runCommand(page, 'TechDocs: Open as Markdown text');
  await typeInText(page, 'marcadortexto');
  await expect(prose(page)).toContainText('marcadortexto');
  await page.waitForTimeout(500);
  await visual(page).locator('.top-bar-item').nth(UNDO).click();
  await expect(prose(page)).not.toContainText('marcadortexto');
  await expect(markdownText(page)).not.toContainText('marcadortexto');
  await save(page);
  await expect.poll(() => file(PAGE)).toBe(original);
});

test('Desfazer pelo visual depois do Desfazer do VS Code continua desfazendo', async ({ vscode: { page, file } }) => {
  const original = file(PAGE);
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' marcadorum');
  await page.waitForTimeout(1_200);
  await page.keyboard.type(' marcadordois');
  await page.waitForTimeout(800);
  await runCommand(page, 'Undo');
  await expect(prose(page)).not.toContainText('marcadordois');
  await expect(prose(page)).toContainText('marcadorum');
  await visual(page).locator('.top-bar-item').nth(UNDO).click();
  await expect(prose(page)).not.toContainText('marcadorum');
  await save(page);
  await expect.poll(() => file(PAGE)).toBe(original);
});

test('botão Desfazer desfaz um passo de cada vez', async ({ vscode: { page, file } }) => {
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' abc');
  await page.waitForTimeout(1_200);
  await page.keyboard.type(' def');
  await page.waitForTimeout(800);
  await visual(page).locator('.top-bar-item').nth(UNDO).click();
  await expect(prose(page)).not.toContainText(' def');
  await expect(prose(page)).toContainText(' abc');
  await visual(page).locator('.top-bar-item').nth(REDO).click();
  await expect(prose(page)).toContainText(' abc def');
  await save(page);
  await expect.poll(() => file(PAGE)).toContain(' abc def');
});

test('edição no visual e no texto ao lado ao mesmo tempo: as duas ficam', async ({ vscode: { page, file } }) => {
  await openVisual(page, PAGE);
  await runCommand(page, 'TechDocs: Open as Markdown text');
  await cursorAtEndOfFirstParagraph(page);
  // Sem esperar o aviso do visual: a mudança do texto chega logo depois
  await page.keyboard.type(' marcadorx');
  await typeInText(page, ' marcadorfim');
  await expect(prose(page)).toContainText('marcadorfim');
  await expect(prose(page).locator('> p').first()).toContainText('marcadorx');
  await expect(markdownText(page)).toContainText('marcadorx');
  await save(page);
  await expect.poll(() => file(PAGE)).toContain('marcadorx');
  await expect.poll(() => file(PAGE)).toContain('marcadorfim');
});

test('depois de desfazer pela barra, o cursor continua onde estava', async ({ vscode: { page, file } }) => {
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.type(' marcadorx');
  await page.waitForTimeout(1_200);
  await page.keyboard.type(' marcadorz');
  await page.waitForTimeout(800);
  await visual(page).locator('.top-bar-item').nth(UNDO).click();
  await expect(prose(page)).not.toContainText('marcadorz');
  await page.keyboard.type('y');
  await expect(prose(page).locator('> p').first()).toContainText('marcadorxy');
  await page.waitForTimeout(800);
  await save(page);
  await expect.poll(() => file(PAGE)).toContain('marcadorxy');
});
