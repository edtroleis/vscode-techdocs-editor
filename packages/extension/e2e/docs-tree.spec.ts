/**
 * Árvore "Documentação" no Explorer (spec 02, LC6): as páginas pelo título, clicar abre a página e a
 * página aberta fica selecionada na árvore.
 */
import { expect, openFile, test } from './vscode';

test('árvore no Explorer: clicar abre a página; a página aberta fica selecionada', async ({ vscode: { page } }, testInfo) => {
  const view = page.locator('.pane', { has: page.locator('.pane-header', { hasText: /^Documentation/i }) });
  await expect(view.locator('.pane-header')).toBeVisible({ timeout: 30_000 });
  // Seção recolhida: abre se precisar (o painel começa recolhido quando o Explorer tem muitas seções)
  if ((await view.locator('.pane-header').getAttribute('aria-expanded')) === 'false') await view.locator('.pane-header').click();
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
  await page.screenshot({ path: testInfo.outputPath('arvore.png') });
});
