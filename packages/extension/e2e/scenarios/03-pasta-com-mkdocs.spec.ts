/**
 * Cenário 3: a Plataforma de Pagamentos, uma pasta local com um site MkDocs antigo (não vai para o Backstage). O menu
 * aponta para uma página apagada, uma página ficou fora do menu, a página inicial tem problemas de formatação. A
 * pessoa ajusta tudo pela extensão e confere que o site gera.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { click, expect, folderFrom, pause, test, type } from './story';
import { buildSite, checkPane, contextMenu, hasWarning, openFromTree, palette, quickInput, sidebarAction, techdocsIcon, toast, treeRow } from './ui';

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
    // A árvore é o menu do site: a seção "Fora do menu" diz quantas páginas ficaram de fora
    await story.check('a página fora do menu marcada', () => expect(treeRow(page, /^Not in the menu/)).toContainText('1'));
    // A seção Guias, antes de abrir, já avisa que uma página do menu dela não existe ("Deploy antigo")
    await story.check('a seção Guias mostra o ⚠ da página que falta', async () => expect(await hasWarning(page, 'Guias')).toBe(true));
    for (const section of ['Guias', 'Operação', /^Not in the menu/]) {
      await expect(treeRow(page, section)).toBeVisible();
      if ((await treeRow(page, section).getAttribute('aria-expanded')) === 'false') await click(page, treeRow(page, section));
    }
    await expect(treeRow(page, 'Deploy antigo')).toBeVisible();
    expect(await hasWarning(page, 'Deploy antigo')).toBe(true);
    await expect(treeRow(page, 'Estorno manual')).toBeVisible();
    // A página inicial tem problemas de formatação (espaços no fim da linha, título que pula de nível) e ninguém a abriu
    await story.check('a página inicial, fechada, já mostra o ⚠ dos problemas de formatação', () => expect.poll(() => hasWarning(page, 'Início'), { timeout: 10_000 }).toBe(true));
    await pause(page, 2_000);
  });

  await story.step('"Deploy antigo" (a página que não existe): o botão direito oferece criar a página ou tirá-la do menu', async () => {
    await treeRow(page, 'Deploy antigo').click({ button: 'right' });
    await story.check('o botão direito tem "Criar a página" e "Tirar do menu"', async () => {
      await expect(page.locator('.context-view .action-item', { hasText: 'Create the Page' })).toBeVisible();
      await expect(page.locator('.context-view .action-item', { hasText: 'Remove from the Menu' })).toBeVisible();
    });
    await page.keyboard.press('Escape');
    await pause(page);
  });

  await story.step('Conferir a documentação: pela paleta e pelo botão Conferir da árvore', async () => {
    // A paleta tem dois comandos parecidos; o "do repositório" põe os achados só no painel Problemas
    await palette(page, 'TechDocs: Check the documentation of the repository');
    await page.waitForTimeout(2_000);
    if (!(await toast(page, /adjustments|without problems/).isVisible()) && !(await checkPane(page).isVisible())) {
      story.suggest(
        'Pela paleta, "TechDocs: Check the documentation of the repository" não dá retorno na tela: os achados vão só para o painel Problemas (fechado), com um número no ícone. Na paleta há também "TechDocs: Check the Documentation" (o botão da árvore), com mensagem e "Fix all automatically": dois comandos quase com o mesmo nome e comportamentos diferentes.',
      );
    }
    await sidebarAction(page, 'Check the Documentation');
    const message = toast(page, /adjustments/);
    await expect(message).toBeVisible();
    await story.check('a mensagem diz quantos ajustes são automáticos e quantos precisam da pessoa', () => expect(message).toContainText(/automatic/));
    await pause(page, 2_000);
  });

  await story.step('"Fix all automatically": a extensão ajusta o que pode, com Desfazer', async () => {
    await click(page, toast(page, /adjustments/).locator('.monaco-button', { hasText: 'Fix all automatically' }));
    const done = toast(page, /adjustments made/);
    await expect(done).toBeVisible();
    await story.check('a mensagem do ajuste tem Desfazer', () => expect(done.locator('.monaco-button', { hasText: 'Undo' })).toBeVisible());
    await written('.markdownlint.yaml').not.toBe('');
    story.ok(`Depois do ajuste automático: ${(await done.innerText()).split('\n')[0]}`);
    await pause(page);
  });

  await story.step('Criar a página "Deploy antigo" (botão direito) e escrever nela', async () => {
    if (!existsSync(join(folder, 'docs/guias/deploy-antigo.md'))) {
      await contextMenu(page, treeRow(page, 'Deploy antigo'), 'Create the Page');
    } else {
      story.ok('O ajuste automático já criou a página que faltava.');
    }
    await written('docs/guias/deploy-antigo.md').toContain('Deploy antigo');
    let editor;
    try {
      editor = await openFromTree(page, 'Deploy antigo');
    } catch {
      story.bug('A página "Deploy antigo", criada pelo ajuste automático, não abre ao clicar nela na árvore (a linha fica selecionada e nada abre).');
      await click(page, treeRow(page, 'Primeiros passos'));
      editor = await openFromTree(page, 'Deploy antigo').catch(() => undefined);
      if (editor) story.ok('Clicando em outra página e voltando, "Deploy antigo" abre.');
      else {
        await contextMenu(page, treeRow(page, 'Deploy antigo'), 'Open in the Visual Editor');
        editor = await openFromTree(page, 'Deploy antigo');
      }
    }
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
    if (await treeRow(page, /^Not in the menu/).count()) {
      await contextMenu(page, treeRow(page, 'Estorno manual'), 'Add to the Menu');
      await expect(treeRow(page, /^Not in the menu/)).toHaveCount(0);
    } else story.ok('O ajuste automático já tinha posto "Estorno manual" no menu.');
    await story.check('a página entra na seção da pasta dela', async () =>
      expect(read('mkdocs.yml')).toContain('  - Operação:\n      - operacao/alertas.md\n      - operacao/estorno.md\n'),
    );
    await pause(page);
  });

  await story.step('Página inicial: "Corrigir automaticamente" resolve a formatação', async () => {
    const editor = await openFromTree(page, 'Início', 'Plataforma de Pagamentos');
    const fix = editor.getByRole('button', { name: 'Fix automatically' });
    if (await fix.waitFor({ timeout: 3_000 }).then(() => true, () => false)) {
      await pause(page);
      await click(page, fix);
      await expect(fix).toHaveCount(0);
    } else {
      story.ok('A formatação da página inicial já tinha sido ajustada pelo "Fix all automatically".');
      await page.keyboard.press('Control+End');
      await type(page, ' ');
      await page.keyboard.press('Backspace');
    }
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
    await sidebarAction(page, 'Check the Documentation');
    await story.check('a conferência diz que a documentação não tem problemas', () => expect(toast(page, /without problems/)).toBeVisible());
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
