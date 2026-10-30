/**
 * Cenário 3: a Plataforma de Pagamentos, uma pasta local com um site MkDocs antigo (não vai para o Backstage). O menu
 * aponta para uma página apagada, uma página ficou fora do menu, a página inicial tem problemas de formatação. A
 * pessoa ajusta tudo pela extensão e confere que o site gera.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { click, expect, folderFrom, pause, test, type } from './story';
import { buildSite, checkPane, checkRow, contextMenu, editorOf, fixFinding, hasWarning, openFromTree, palette, quickInput, techdocsIcon, treeRow } from './ui';

const folder = folderFrom('site-legado', 'pagamentos');
const read = (path: string) => readFileSync(join(folder, path), 'utf8');
/** O arquivo, quando a extensão terminar de gravar ('' antes). */
const written = (path: string) =>
  expect.poll(() => {
    try {
      return read(path);
    } catch {
      return '';
    }
  });

test.use({
  folder,
  scenario: {
    id: '03-pasta-com-mkdocs',
    title: 'Pasta local com mkdocs: ajustar um site antigo',
    summary:
      'A Plataforma de Pagamentos, numa pasta local com um site MkDocs antigo (sem Backstage). O menu aponta para uma página apagada, uma página ficou fora do menu e a página inicial tem problemas de formatação. A pessoa ajusta tudo pela extensão, renomeia e reordena o menu, e confere que o site gera.',
  },
});

test('pasta local com mkdocs: ajustar um site antigo', async ({ vscode: { page }, story }) => {
  await story.step('Abrir a barra lateral TechDocs: o menu do site, com o que está errado', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    for (const section of ['Guias', 'Operação', /^Not in the menu/]) {
      await expect(treeRow(page, section)).toBeVisible();
      if ((await treeRow(page, section).getAttribute('aria-expanded')) === 'false') await click(page, treeRow(page, section));
    }
    await expect(treeRow(page, 'Deploy antigo')).toBeVisible();
    expect(await hasWarning(page, 'Deploy antigo')).toBe(true);
    await expect(treeRow(page, 'Estorno manual')).toBeVisible();
    if (!(await hasWarning(page, 'Início'))) {
      story.suggest(
        'A página inicial tem problemas de formatação (espaços no fim da linha, título que pula de nível), mas a árvore só mostra o ⚠ depois que a página é aberta; ao fechar a aba, ele some de novo. Num site antigo, a pessoa não vê onde estão os problemas.',
      );
    }
    await pause(page, 2_000);
  });

  await story.step('"Deploy antigo" (a página que não existe): o botão direito não oferece nada', async () => {
    await treeRow(page, 'Deploy antigo').click({ button: 'right' });
    await page.waitForTimeout(500);
    if (!(await page.locator('.context-view .action-item').count())) {
      story.suggest(
        'A página do menu que não existe só tem o ⚠ com a dica. O botão direito não tem ação: faltam "Criar a página" e "Tirar do menu" ali mesmo. Hoje a correção está só na Manutenção (e só cria a página).',
      );
    }
    await page.keyboard.press('Escape');
    await pause(page);
  });

  await story.step('Conferir a documentação pela paleta: a seção Manutenção mostra o que corrigir', async () => {
    await palette(page, 'TechDocs: Check the documentation');
    await expect(checkPane(page)).toBeVisible();
    await expect(checkRow(page, 'guias/deploy-antigo.md')).toBeVisible();
    await expect(checkRow(page, 'operacao/estorno.md')).toBeVisible();
    await expect(checkRow(page, 'docs/index.md')).toBeVisible();
    if (await checkRow(page, 'No catalog-info.yaml').isVisible()) {
      story.suggest(
        'Num repositório que não vai para o Backstage, a conferência acusa a falta do catalog-info.yaml. Depois do "Não" na pergunta do Backstage (cenário 1), ou com uma opção aqui, a conferência podia deixar isso de fora.',
      );
    }
    await pause(page, 2_000);
  });

  await story.step('Usar a configuração de formatação sugerida (.markdownlint.yaml)', async () => {
    await fixFinding(page, checkRow(page, '.markdownlint.yaml'));
    await written('.markdownlint.yaml').not.toBe('');
    await pause(page);
  });

  await story.step('Criar a página "Deploy antigo" pela correção, e escrever nela', async () => {
    await fixFinding(page, checkRow(page, 'guias/deploy-antigo.md'));
    await written('docs/guias/deploy-antigo.md').toContain('Deploy antigo');
    const editor = await openFromTree(page, 'Deploy antigo');
    await editor.locator('.ProseMirror h1').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, 'O deploy antigo foi substituído pelo pipeline do GitHub Actions. Use o guia Primeiros passos.');
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tab.active.dirty')).toHaveCount(0);
    expect(read('docs/guias/deploy-antigo.md')).toContain('foi substituído pelo pipeline');
    await pause(page);
  });

  await story.step('Pôr "Estorno manual" no menu: entra em Operação, junto de Alertas', async () => {
    await contextMenu(page, treeRow(page, 'Estorno manual'), 'Add to the Menu');
    await expect(treeRow(page, /^Not in the menu/)).toHaveCount(0);
    await story.check('a página entra na seção da pasta dela', async () =>
      expect(read('mkdocs.yml')).toContain('  - Operação:\n      - operacao/alertas.md\n      - operacao/estorno.md\n'),
    );
    await pause(page);
  });

  await story.step('Página inicial: "Corrigir automaticamente" resolve a formatação', async () => {
    const editor = await openFromTree(page, 'Início', 'Plataforma de Pagamentos');
    const fix = editor.getByRole('button', { name: 'Fix automatically' });
    await expect(fix).toBeVisible();
    await pause(page);
    await click(page, fix);
    await expect(fix).toHaveCount(0);
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tab.active.dirty')).toHaveCount(0);
    const text = read('docs/index.md');
    expect(text).not.toMatch(/ +$/m);
    expect(text).toContain('## Quem procurar');
    await pause(page);
  });

  await story.step('Renomear "Primeiros passos" para "Como rodar na sua máquina"', async () => {
    await contextMenu(page, treeRow(page, 'Primeiros passos'), /^Rename/);
    const input = quickInput(page).locator('input');
    await expect(input).toBeVisible();
    await expect(quickInput(page)).toContainText('primeiros-passos.md');
    await page.keyboard.press('Control+A');
    await type(page, 'Como rodar na sua máquina');
    await page.keyboard.press('Enter');
    await expect(treeRow(page, 'Como rodar na sua máquina')).toBeVisible();
    expect(read('docs/guias/primeiros-passos.md')).toMatch(/^# Como rodar na sua máquina\n/);
    await pause(page);
  });

  await story.step('Subir a seção Operação para antes de Guias', async () => {
    await contextMenu(page, treeRow(page, 'Operação'), 'Move Up');
    await expect(page.locator('.notification-toast', { hasText: '"Operação" changed position in the menu.' })).toBeVisible();
    expect(read('mkdocs.yml').indexOf('Operação')).toBeLessThan(read('mkdocs.yml').indexOf('Guias'));
    await pause(page);
  });

  await story.step('Conferir de novo: nenhum problema nas páginas', async () => {
    await palette(page, 'TechDocs: Check the documentation');
    for (const gone of ['guias/deploy-antigo.md', 'operacao/estorno.md', 'docs/index.md', '.markdownlint.yaml']) {
      await story.check(`a conferência não acusa mais ${gone}`, () => expect(checkRow(page, gone)).toHaveCount(0));
    }
    for (const label of ['Início', 'Como rodar na sua máquina', 'Deploy antigo', 'Alertas', 'Estorno manual']) {
      await story.check(`sem ⚠ em ${label}`, async () => expect(await hasWarning(page, label)).toBe(false));
    }
    await pause(page, 2_000);
  });

  await story.step('O site gera com o MkDocs (como na pipeline do TechDocs)', async () => {
    const result = buildSite(folder);
    if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
  });
});
