/**
 * Barra lateral TechDocs: o ícone na barra de atividades abre a árvore "Documentação" (spec 02, LC6) e a
 * "Verificação" (spec 04, T3b). Na árvore, clicar abre a página e a página aberta fica selecionada; a
 * Verificação confere sozinha ao aparecer.
 */
import { expect, openFile, test } from './vscode';

test('barra lateral TechDocs: árvore e verificação; clicar abre a página; a página aberta fica selecionada', async ({ vscode: { page } }, testInfo) => {
  const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
  await expect(icon).toBeVisible({ timeout: 30_000 });
  await icon.click();

  const pane = (title: RegExp) => page.locator('.pane', { has: page.locator('.pane-header', { hasText: title }) });
  const view = pane(/^Documentation/i);
  await expect(view.locator('.pane-header')).toBeVisible();
  const rows = view.locator('.monaco-list-row');
  const wiki = rows.filter({ hasText: /^Wiki de Demonstração\s*wiki$/ });
  await expect(wiki).toBeVisible();

  const guias = rows.filter({ hasText: /^Guias$/ }).first();
  await guias.click();
  await rows.filter({ hasText: /^Primeiros passos$/ }).first().click();
  await expect(page.locator('.tab.active', { hasText: 'primeiros-passos.md' })).toBeVisible();

  // Outra página aberta por fora da árvore: ela fica selecionada na árvore
  await openFile(page, 'wiki/docs/processos/aprovacao.md');
  await expect(rows.filter({ hasText: /^Processo de aprovação$/ }).first()).toHaveClass(/selected/);

  // Verificação: confere sozinha e agrupa por tipo (as wikis de teste não têm catalog-info.yaml)
  const check = pane(/^Check/i);
  if ((await check.locator('.pane-header').getAttribute('aria-expanded')) === 'false') await check.locator('.pane-header').click();
  await expect(check.locator('.monaco-list-row', { hasText: 'No catalog-info.yaml' }).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('barra-lateral.png') });
});
