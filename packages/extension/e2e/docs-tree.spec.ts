/**
 * Barra lateral TechDocs: o ícone na barra de atividades abre a árvore "Documentação" (spec 02, LC6) e a
 * "Manutenção" (spec 04, T3b, só com `techdocsEditor.maintainer`). Com dois sites e nenhuma página aberta, a
 * árvore pede a escolha do diretório; escolhido, clicar abre a página e a página aberta fica selecionada; a Manutenção
 * confere sozinha ao aparecer.
 */
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, openFile, test, visual } from './vscode';

test.use({ settings: { 'techdocsEditor.maintainer': true } });

test('barra lateral TechDocs: escolher o site; árvore e manutenção; clicar abre a página; a página aberta fica selecionada', async ({ vscode: { page } }, testInfo) => {
  const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
  await expect(icon).toBeVisible({ timeout: 30_000 });
  await icon.click();

  const pane = (title: RegExp) => page.locator('.pane', { has: page.locator('.pane-header', { hasText: title }) });
  const view = pane(/^Documentation/i);
  await expect(view.locator('.pane-header')).toBeVisible();
  const rows = view.locator('.monaco-list-row');
  // Dois sites e nenhuma página aberta: a escolha, pela lista de diretórios
  await view.getByRole('button', { name: 'Choose directory or repo…' }).click();
  await page.locator('.quick-input-widget').getByRole('option', { name: /(^|\s)wiki, documentation/ }).click();
  // Árvore do menu do site: seções pelas pastas, páginas pelo título
  const guias = rows.filter({ hasText: /^guias$/i }).first();
  await expect(guias).toBeVisible();
  if ((await guias.getAttribute('aria-expanded')) === 'false') await guias.click();
  await rows.filter({ hasText: /^Primeiros passos/ }).first().click();
  await expect(page.locator('.tab.active', { hasText: 'primeiros-passos.md' })).toBeVisible();
  // O webview carregando fica com o foco e engole as teclas (o Ctrl+P do openFile): espera o editor pronto
  await expect(visual(page).locator('.milkdown')).toBeVisible();

  // Outra página aberta por fora da árvore: ela fica selecionada na árvore
  await openFile(page, 'wiki/docs/processos/aprovacao.md');
  await expect(rows.filter({ hasText: /^Processo de aprovação/ }).first()).toHaveClass(/selected/);

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

test('só teclado: setas até uma página da árvore e Enter abre no editor visual', async ({ vscode: { page } }) => {
  const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
  await expect(icon).toBeVisible({ timeout: 30_000 });
  await icon.click();
  const view = page.locator('.pane', { has: page.locator('.pane-header', { hasText: /^Documentation/i }) });
  const rows = view.locator('.monaco-list-row');
  await view.getByRole('button', { name: 'Choose directory or repo…' }).click();
  await page.locator('.quick-input-widget').getByRole('option', { name: /(^|\s)wiki, documentation/ }).click();
  const guias = rows.filter({ hasText: /^guias$/i }).first();
  await expect(guias).toBeVisible();
  // Uma página selecionada com o mouse; depois, só o teclado: as setas mudam o foco, não a seleção
  await rows.filter({ hasText: /^Início|^Wiki/ }).first().click();
  const shown = async () => {
    const frames = page.locator('iframe.webview.ready');
    for (let i = 0; i < (await frames.count()); i++) {
      if (!(await frames.nth(i).isVisible())) continue;
      return page.frameLocator('iframe.webview.ready').nth(i).frameLocator('iframe#active-frame').locator('.milkdown .ProseMirror');
    }
    return undefined;
  };
  await expect.poll(async () => (await shown())?.locator('h1').first().textContent()).toContain('Wiki');
  await view.locator('.monaco-list').focus();
  const focused = view.locator('.monaco-list-row.focused');
  for (let i = 0; i < 10 && !/^guias$/i.test(((await focused.textContent()) ?? '').trim()); i++) await page.keyboard.press('ArrowDown');
  await expect(focused).toHaveText(/^guias$/i);
  if ((await guias.getAttribute('aria-expanded')) === 'false') await page.keyboard.press('ArrowRight');
  await expect(rows.filter({ hasText: /^Primeiros passos/ }).first()).toBeVisible();
  for (let i = 0; i < 10 && !/^Primeiros passos/.test(((await focused.textContent()) ?? '').trim()); i++) await page.keyboard.press('ArrowDown');
  await expect(focused).toHaveText(/^Primeiros passos/);
  await page.keyboard.press('Enter');
  await expect(page.locator('.tab.active', { hasText: 'primeiros-passos.md' })).toBeVisible();
  // A página que abriu é a da linha focada
  await expect.poll(async () => (await shown())?.locator('h1').first().textContent()).toContain('Primeiros passos');
});

test.describe('página do menu que passa a existir', () => {
  const folder = join(mkdtempSync(join(tmpdir(), 'techdocs-missing-')), 'pagamentos');
  cpSync(join(__dirname, 'scenarios/fixtures/site-legado'), folder, { recursive: true });
  test.use({ folder });

  test('clicar logo depois de a página ser criada abre a página (antes de a árvore se atualizar)', async ({ vscode: { page } }) => {
    const icon = page.locator('.activitybar .action-item a[aria-label^="TechDocs"]');
    await expect(icon).toBeVisible({ timeout: 30_000 });
    await icon.click();
    const rows = page.locator('.pane', { has: page.locator('.pane-header', { hasText: /^Documentation/i }) }).locator('.monaco-list-row');
    const row = (label: string) => rows.filter({ has: page.locator('.label-name', { hasText: new RegExp(`^${label}$`) }) }).first();
    await row('Guias').click();
    await expect(row('Deploy antigo')).toBeVisible();
    // Como o "Ajustar automaticamente" criando a página; o clique vem antes de a árvore trocar o item
    writeFileSync(join(folder, 'docs/guias/deploy-antigo.md'), '# Deploy antigo\n\nTexto.\n');
    await row('Deploy antigo').click();
    await expect(page.locator('.tab.active', { hasText: 'deploy-antigo.md' })).toBeVisible();
  });
});
