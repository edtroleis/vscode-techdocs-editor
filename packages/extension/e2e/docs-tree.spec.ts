/**
 * Barra lateral TechDocs: o ícone na barra de atividades abre a árvore "Documentação" (spec 02, LC6) e a
 * "Manutenção" (spec 04, T3b, só com `techdocsEditor.maintainer`). Com dois sites e nenhuma página aberta, a
 * árvore pede a escolha; escolhido, clicar abre a página e a página aberta fica selecionada; a Manutenção
 * confere sozinha ao aparecer.
 */
import { expect, openFile, test } from './vscode';

test.use({ settings: { 'techdocsEditor.maintainer': true } });

test('barra lateral TechDocs: escolher o site; árvore e manutenção; clicar abre a página; a página aberta fica selecionada', async ({ vscode: { page } }, testInfo) => {
  const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
  await expect(icon).toBeVisible({ timeout: 30_000 });
  await icon.click();

  const pane = (title: RegExp) => page.locator('.pane', { has: page.locator('.pane-header', { hasText: title }) });
  const view = pane(/^Documentation/i);
  await expect(view.locator('.pane-header')).toBeVisible();
  const rows = view.locator('.monaco-list-row');
  // Dois sites e nenhuma página aberta: a escolha, pela lista agrupada por repositório
  await view.getByRole('button', { name: 'Choose documentation…' }).click();
  await page.locator('.quick-input-widget').getByRole('option', { name: /Wiki de Demonstração, wiki(,|$)/ }).click();
  const wiki = rows.filter({ hasText: /^Wiki de Demonstração\s*wiki$/ });
  await expect(wiki).toBeVisible();

  const guias = rows.filter({ hasText: /^Guias$/ }).first();
  await guias.click();
  await rows.filter({ hasText: /^Primeiros passos$/ }).first().click();
  await expect(page.locator('.tab.active', { hasText: 'primeiros-passos.md' })).toBeVisible();

  // Outra página aberta por fora da árvore: ela fica selecionada na árvore
  await openFile(page, 'wiki/docs/processos/aprovacao.md');
  await expect(rows.filter({ hasText: /^Processo de aprovação$/ }).first()).toHaveClass(/selected/);

  // O site atual na barra de status abre a lista; a busca acha as páginas de todos os sites
  await page.locator('.statusbar-item', { hasText: 'Wiki de Demonstração' }).first().click();
  await page.locator('.quick-input-widget input').fill('imagens');
  await page.locator('.quick-input-widget').getByRole('option', { name: /^file Imagens/ }).first().click();
  await expect(page.locator('.tab.active', { hasText: 'imagens.md' })).toBeVisible();

  // Manutenção: confere sozinha. As wikis de teste não têm catalog-info.yaml, nem outro repositório do workspace
  // (sem Backstage): a falta dele não aparece
  const check = pane(/^Maintenance/i);
  if ((await check.locator('.pane-header').getAttribute('aria-expanded')) === 'false') await check.locator('.pane-header').click();
  await expect(check.locator('.monaco-list-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(check.locator('.monaco-list-row', { hasText: 'No catalog-info.yaml' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('barra-lateral.png') });
});
