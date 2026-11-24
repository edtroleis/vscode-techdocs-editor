import { expect, Page, test } from '@playwright/test';
import { editor, expectSaved, newLineAtEnd, openEditor, slash } from './helpers';

/** Componentes do TechDocs no editor visual (spec 01, M1): avisos, recolhíveis e abas. */

const PAGE = `# Integração

!!! tip "Comece pelo contrato"
    Escreva o OpenAPI antes do código.

=== "Síncrono"

    Chamada HTTP.

=== "Assíncrono"

    Evento na fila.

Fim.
`;

const bar = (page: Page) => page.locator('.td-bar');
const tabs = (page: Page) => page.locator('.td-tabs [role=tab]');

async function clickBody(page: Page) {
  await page.locator('.td-admonition p', { hasText: 'OpenAPI' }).click();
  await expect(bar(page)).toBeVisible();
}

async function chooseFromBar(page: Page, button: RegExp, item: string) {
  await bar(page).getByRole('button', { name: button }).click();
  await page.getByRole('menuitemradio', { name: item, exact: true }).click();
}

test('o aviso aparece com a cor do tipo, o título e o texto; abrir não muda nada', async ({ page }) => {
  const { errors } = await openEditor(page, PAGE);
  const tip = page.locator('.td-admonition.td-kind-tip');
  await expect(tip.locator('.td-title')).toHaveText('Comece pelo contrato');
  await expect(tip.locator('p')).toHaveText('Escreva o OpenAPI antes do código.');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.harness.changes)).toBe(0);
  expect(errors).toEqual([]);
});

test('editar o título e o texto do aviso', async ({ page }) => {
  await openEditor(page, PAGE);
  await page.locator('.td-title').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' sempre');
  // Enter no título vai para o texto
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type(' Depois, o código.');
  await expectSaved(
    page,
    PAGE.replace('contrato"', 'contrato sempre"').replace('antes do código.', 'antes do código. Depois, o código.'),
  );
});

test('título vazio mostra o nome do tipo e salva sem título', async ({ page }) => {
  await openEditor(page, PAGE);
  await page.locator('.td-title').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.td-title')).toHaveAttribute('data-placeholder', 'Tip');
  await expectSaved(page, PAGE.replace('!!! tip "Comece pelo contrato"', '!!! tip'));
});

test('Tipo ▾ troca o tipo do aviso', async ({ page }) => {
  await openEditor(page, PAGE);
  await clickBody(page);
  await chooseFromBar(page, /Tipo/, 'Atenção');
  await expect(page.locator('.td-admonition.td-kind-warning')).toHaveCount(1);
  await expectSaved(page, PAGE.replace('!!! tip', '!!! warning'));
});

test('Recolhível ▾: fechado, aberto e sempre aberto', async ({ page }) => {
  await openEditor(page, PAGE);
  await clickBody(page);
  await chooseFromBar(page, /Recolhível/, 'Recolhível, começa fechado');
  await expectSaved(page, PAGE.replace('!!! tip', '??? tip'));
  await chooseFromBar(page, /Recolhível/, 'Recolhível, começa aberto');
  await expectSaved(page, PAGE.replace('!!! tip', '???+ tip'));
  await chooseFromBar(page, /Recolhível/, 'Sempre aberto');
  await expectSaved(page, PAGE);
});

test('abas: só a escolhida aparece; clicar troca', async ({ page }) => {
  await openEditor(page, PAGE);
  await expect(tabs(page)).toHaveText(['Síncrono', 'Assíncrono']);
  await expect(editor(page).getByText('Chamada HTTP.')).toBeVisible();
  await expect(editor(page).getByText('Evento na fila.')).toBeHidden();
  await tabs(page).nth(1).click();
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(editor(page).getByText('Evento na fila.')).toBeVisible();
  await expect(editor(page).getByText('Chamada HTTP.')).toBeHidden();
  // O cursor fica na aba escolhida: digitar escreve nela
  await page.keyboard.press('End');
  await page.keyboard.type(' Com retentativa.');
  await expectSaved(page, PAGE.replace('Evento na fila.', 'Evento na fila. Com retentativa.'));
});

test('abas: renomear com clique duplo', async ({ page }) => {
  await openEditor(page, PAGE);
  await tabs(page).first().dblclick();
  const input = page.locator('.td-tab-rename');
  await expect(input).toBeFocused();
  await input.fill('HTTP');
  await input.press('Enter');
  await expect(tabs(page)).toHaveText(['HTTP', 'Assíncrono']);
  await expectSaved(page, PAGE.replace('=== "Síncrono"', '=== "HTTP"'));
});

test('abas: mover para a direita e excluir pelo menu do botão direito', async ({ page }) => {
  await openEditor(page, PAGE);
  await tabs(page).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover para a direita' }).click();
  await expect(tabs(page)).toHaveText(['Assíncrono', 'Síncrono']);
  await expectSaved(
    page,
    PAGE.replace(
      '=== "Síncrono"\n\n    Chamada HTTP.\n\n=== "Assíncrono"\n\n    Evento na fila.',
      '=== "Assíncrono"\n\n    Evento na fila.\n\n=== "Síncrono"\n\n    Chamada HTTP.',
    ),
  );
  await tabs(page).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Excluir aba' }).click();
  await expect(tabs(page)).toHaveText(['Síncrono']);
  await expectSaved(page, PAGE.replace('=== "Assíncrono"\n\n    Evento na fila.\n\n', ''));
});

test('abas: + cria uma aba nova com o nome para trocar', async ({ page }) => {
  await openEditor(page, PAGE);
  await page.locator('.td-tab-add').click();
  const input = page.locator('.td-tab-rename');
  await expect(input).toBeFocused();
  await input.fill('Lote');
  await input.press('Enter');
  await expect(tabs(page)).toHaveText(['Síncrono', 'Assíncrono', 'Lote']);
  await page.keyboard.type('Uma vez por dia.');
  await expectSaved(page, PAGE.replace('Evento na fila.\n', 'Evento na fila.\n\n=== "Lote"\n\n    Uma vez por dia.\n'));
});

test('menu /: aviso e abas entram prontos para escrever', async ({ page }) => {
  await openEditor(page);
  await newLineAtEnd(page);
  await slash(page, 'Aviso');
  await page.keyboard.type('Importante');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Leia antes.');
  await expectSaved(page, '# Página\n\nTexto inicial.\n\n!!! note "Importante"\n    Leia antes.\n');
  await page.keyboard.press('Control+End');
  await newLineAtEnd(page);
  await slash(page, 'Abas');
  await page.keyboard.type('Primeira.');
  await expectSaved(
    page,
    '# Página\n\nTexto inicial.\n\n!!! note "Importante"\n    Leia antes.\n\n=== "Aba 1"\n\n    Primeira.\n\n=== "Aba 2"\n',
  );
});
