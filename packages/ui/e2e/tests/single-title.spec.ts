import { expect, test } from '@playwright/test';
import { chooseHeading, editor, expectLintClean, expectSaved, newLineAtEnd, openEditor, ORIGINAL, slash } from './helpers';

/** O Título 1 é o nome da página: um segundo vira Título 2, por qualquer caminho (lint MD025). */

test('Título 1 pela barra, numa página que já tem título, vira Título 2', async ({ page }) => {
  await openEditor(page);
  await newLineAtEnd(page);
  await chooseHeading(page, 'Título 1');
  await page.keyboard.type('Links relacionados');
  await expectSaved(page, `${ORIGINAL}\n## Links relacionados\n`);
  await expect(editor(page).locator('h1')).toHaveCount(1);
  await expectLintClean(page);
});

test('Título 1 pelo menu "/" e por "# " também viram Título 2', async ({ page }) => {
  await openEditor(page);
  await newLineAtEnd(page);
  await slash(page, 'Título 1');
  await page.keyboard.type('Um');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Dois');
  await expectSaved(page, `${ORIGINAL}\n## Um\n\n## Dois\n`);
});

test('página sem título: o Título 1 fica', async ({ page }) => {
  await openEditor(page, 'Texto inicial.\n');
  await newLineAtEnd(page);
  await chooseHeading(page, 'Título 1');
  await page.keyboard.type('Nome');
  await expectSaved(page, 'Texto inicial.\n\n# Nome\n');
});

test('abrir um arquivo com dois Títulos 1 não muda nada', async ({ page }) => {
  await openEditor(page, '# Um\n\nTexto.\n\n# Dois\n');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.harness.changes)).toBe(0);
  await expect(editor(page).locator('h1')).toHaveCount(2);
});

test('linha vazia não desalinha os números de linha', async ({ page }) => {
  await openEditor(page);
  await newLineAtEnd(page);
  await page.keyboard.press('Enter');
  await chooseHeading(page, 'Título 2');
  await page.keyboard.type('Seção');
  await expectSaved(page, `${ORIGINAL}\n## Seção\n`);
  const lines = page.locator('.milkdown').locator('xpath=../..').locator('> span');
  await expect.poll(async () => (await lines.allTextContents()).map(t => t.replace(/\D/g, ''))).toEqual(['1', '3', '5']);
});
