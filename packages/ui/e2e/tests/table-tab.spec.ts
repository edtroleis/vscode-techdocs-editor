import { expect, test } from '@playwright/test';
import { editor, expectSaved, openEditor } from './helpers';

const TABLE = '# Página\n\n| Método | Caminho |\n| :----- | ------: |\n| GET    | /a      |\n';

/** Quem vem do Word, do Notion ou do GitHub espera que o Tab na última célula crie uma linha. */
test('Tab na última célula cria uma linha nova e leva o cursor para ela', async ({ page }) => {
  await openEditor(page, TABLE);
  await editor(page).locator('td', { hasText: '/a' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await page.keyboard.type('POST', { delay: 20 });
  await page.keyboard.press('Tab');
  await page.keyboard.type('/b', { delay: 20 });
  await expect(editor(page).locator('tr')).toHaveCount(3);
  // O alinhamento das colunas continua o mesmo
  await expectSaved(page, '# Página\n\n| Método | Caminho |\n| :----- | ------: |\n| GET    |      /a |\n| POST   |      /b |\n');
});

test('Shift+Tab na linha nova volta para a célula anterior, sem criar outra', async ({ page }) => {
  await openEditor(page, TABLE);
  await editor(page).locator('td', { hasText: '/a' }).click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('X');
  await expect(editor(page).locator('tr')).toHaveCount(3);
});
