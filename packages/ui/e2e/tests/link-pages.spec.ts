import { expect, test } from '@playwright/test';
import { ORIGINAL, clickTopBar, editor, expectSaved, newLineAtEnd, openEditor, selectBlockText } from './helpers';

const paragraph = (page: import('@playwright/test').Page) => editor(page).locator('> p').first();
const suggestions = (page: import('@playwright/test').Page) => page.locator('.docs-link-pages [role=option]');

/** Quem escreve pensa no título da página, não no nome do arquivo: a caixa de link lista as páginas do site. */
test.describe('caixa de link: páginas do site', () => {
  test('lista as páginas, filtra sem acento e grava o link relativo no texto selecionado', async ({ page }) => {
    await openEditor(page);
    await selectBlockText(page, paragraph(page));
    await clickTopBar(page, 'link');
    const input = page.locator('.milkdown-link-edit input');
    await expect(input).toBeFocused();
    await expect(suggestions(page)).toHaveText([/Início/, /Referência da API/, /Rotina de backup/, /Rascunho.*fora do menu/]);
    await input.pressSequentially('referencia', { delay: 20 });
    await expect(suggestions(page)).toHaveText([/Referência da API/]);
    await input.press('Enter');
    await expectSaved(page, ORIGINAL.replace('Texto inicial.', '[Texto inicial.](../referencia-da-api.md)'));
  });

  test('sem texto selecionado, o texto do link é o título da página; setas e clique escolhem', async ({ page }) => {
    await openEditor(page);
    await newLineAtEnd(page);
    await page.keyboard.type('Veja ', { delay: 20 });
    await clickTopBar(page, 'link');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // O que vem depois fica fora do link
    await page.keyboard.type('.', { delay: 20 });
    await expectSaved(page, `${ORIGINAL}\nVeja [Referência da API](../referencia-da-api.md).\n`);
    await newLineAtEnd(page);
    await clickTopBar(page, 'link');
    await suggestions(page).filter({ hasText: 'Rotina de backup' }).click();
    await expectSaved(page, `${ORIGINAL}\nVeja [Referência da API](../referencia-da-api.md).\n\n[Rotina de backup](backup.md)\n`);
  });

  test('endereço https: a lista some e vale o que foi digitado', async ({ page }) => {
    await openEditor(page);
    await selectBlockText(page, paragraph(page));
    await clickTopBar(page, 'link');
    const input = page.locator('.milkdown-link-edit input');
    await input.fill('https://exemplo.com');
    await expect(suggestions(page)).toHaveCount(0);
    await input.press('Enter');
    await expectSaved(page, ORIGINAL.replace('Texto inicial.', '[Texto inicial.](https://exemplo.com)'));
  });

  test('caixa perto do fim da tela: a lista abre para cima e fica visível', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 420 });
    await openEditor(page, `# Página\n\n${'Parágrafo.\n\n'.repeat(12)}Fim.\n`);
    await editor(page).locator('> p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Veja ');
    await clickTopBar(page, 'link');
    const list = page.locator('.docs-link-pages');
    await expect(list).toBeVisible();
    const box = (await list.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(420);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});
