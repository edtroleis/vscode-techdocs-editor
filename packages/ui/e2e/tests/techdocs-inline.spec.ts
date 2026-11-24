import { expect, test } from '@playwright/test';
import { clickTopBar, expectSaved, newLineAtEnd, openEditor, slash } from './helpers';

/** Botão e glossário do TechDocs no editor visual (spec 01, M1). */

const PAGE = `# Atalhos

[Abrir o portal](https://exemplo.com){ .md-button }

[Começar](https://exemplo.com/inicio){ .md-button .md-button--primary }

ADR
:   Architecture Decision Record.

Fim.
`;

test('botão e glossário aparecem como no Backstage; abrir não muda nada', async ({ page }) => {
  const { errors } = await openEditor(page, PAGE);
  await expect(page.locator('.td-md-button', { hasText: 'Abrir o portal' })).toBeVisible();
  await expect(page.locator('.td-md-button--primary', { hasText: 'Começar' })).toBeVisible();
  // Os atributos e o ":" só aparecem com o cursor no parágrafo
  await expect(page.locator('.td-attrs').first()).toBeHidden();
  await expect(page.locator('.td-deflist .td-dt')).toHaveText('ADR');
  await expect(page.locator('.td-dd-mark')).toBeHidden();
  await page.locator('p', { hasText: 'Architecture' }).click();
  await expect(page.locator('.td-dd-mark')).toBeVisible();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.harness.changes)).toBe(0);
  expect(errors).toEqual([]);
});

test('/ Glossário insere termo e significado', async ({ page }) => {
  await openEditor(page, PAGE);
  await newLineAtEnd(page);
  await slash(page, 'Glossário');
  await page.keyboard.type('SLA');
  await expectSaved(page, `${PAGE}\nSLA\n:   O que o termo significa.\n`);
});

test('/ Botão insere o link com .md-button e abre a caixa do endereço', async ({ page }) => {
  await openEditor(page, PAGE);
  await newLineAtEnd(page);
  await slash(page, 'Botão');
  const field = page.locator('.milkdown-link-edit input');
  await expect(field).toBeFocused();
  await field.fill('https://exemplo.com/novo');
  await field.press('Enter');
  await expectSaved(page, `${PAGE}\n[Texto do botão](https://exemplo.com/novo){ .md-button }\n`);
});

test('/ Link para outra doc: a caixa de link com as docs do Backstage, grava o caminho do portal', async ({ page }) => {
  await openEditor(page, PAGE);
  await newLineAtEnd(page);
  await slash(page, 'Link para outra doc');
  const field = page.locator('.milkdown-link-edit input');
  await expect(field).toBeFocused();
  await field.pressSequentially('golden', { delay: 20 });
  await expect(page.locator('.docs-link-pages [role=option]')).toHaveText([/Golden Path de Arquitetura.*wiki-golden-path/]);
  await field.press('Enter');
  await expectSaved(page, `${PAGE}\n[Golden Path de Arquitetura](/docs/default/component/wiki-golden-path/)\n`);
});

test('botão TechDocs da barra: o mesmo grupo; o componente entra depois do parágrafo, sem apagar o texto', async ({ page }) => {
  await openEditor(page, PAGE);
  await page.locator('p', { hasText: 'Fim.' }).click();
  await clickTopBar(page, 'techdocs');
  const menu = page.getByRole('menu', { name: 'TechDocs' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Aviso', 'Recolhível', 'Abas', 'Cards', 'Botão', 'Glossário', 'Link para outra doc']);
  await menu.getByRole('menuitem', { name: 'Aviso' }).click();
  await expect(menu).toBeHidden();
  await page.keyboard.type('Atenção');
  await expectSaved(page, `${PAGE}\n!!! note "Atenção"\n`);
});
