/**
 * Cenário 7: o Manual da Loja, um site local com páginas que apontam umas para as outras (inclusive para uma seção,
 * `api.md#erros`). A pessoa reorganiza o menu pela barra lateral TechDocs: seção nova, página nova nela, mover,
 * duplicar, excluir e desfazer, filtrar, apagar uma seção. No fim, nenhum link quebrado e o site gera.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { click, expect, folderFrom, pause, test, toEnd, type } from './story';
import {
  answer,
  buildSite,
  confirm,
  contextMenu,
  editorOf,
  expandRow,
  openFromTree,
  pick,
  quickInput,
  save,
  sidebarAction,
  techdocsIcon,
  toast,
  treeRow,
  treeRows,
} from './ui';

const folder = folderFrom('manual-loja', 'manual-loja');
const read = (path: string) => readFileSync(join(folder, path), 'utf8');
const exists = (path: string) => existsSync(join(folder, path));

test.use({
  folder,
  settings: { 'window.dialogStyle': 'custom' },
  scenario: {
    id: '07-organizar-manual',
    title: 'Organizar o menu de um manual com links entre páginas',
    summary:
      'O Manual da Loja, um site local com páginas ligadas umas às outras. A pessoa cria a seção Operação com uma página nova, move a API para Guias, duplica e exclui uma página (e desfaz), filtra a árvore, apaga a seção vazia e confere que nenhum link quebrou e o site gera.',
  },
});

test('organizar o menu de um manual com links entre páginas', async ({ vscode: { page }, story }) => {
  await story.step('Abrir a barra lateral TechDocs: o menu do manual', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    for (const label of ['Início', 'Guias', 'Referência']) await expect(treeRow(page, label)).toBeVisible();
    await expandRow(page, treeRow(page, 'Guias'));
    await expandRow(page, treeRow(page, 'Referência'));
    await expect(treeRow(page, 'Configurar')).toBeVisible();
    await pause(page);
  });

  await story.step('Nova seção "Operação" pelo botão da barra', async () => {
    await sidebarAction(page, 'New Section');
    await answer(page, 'Operação');
    await expect(quickInput(page)).toBeHidden();
    // A seção nasce com uma página de mesmo nome, aberta para escrever
    await story.check('a página da seção abre no editor', () => expect(page.locator('.tab.active')).toContainText('index.md', { timeout: 15_000 }));
    await expect(treeRow(page, 'Operação')).toBeVisible();
    await story.check('a seção vai para o mkdocs.yml', () => expect.poll(() => read('mkdocs.yml')).toContain('Operação'));
    await pause(page);
  });

  await story.step('Página nova "Backup" dentro de Operação (botão direito na seção)', async () => {
    await contextMenu(page, treeRow(page, 'Operação'), 'New Page in This Section');
    await pick(page, 'Blank page');
    await answer(page, 'Backup', /Title of the new page/);
    await answer(page, undefined, /File of the new page/);
    // Dentro de uma seção, a página já sabe onde entra no menu; senão vem a pergunta do menu
    const nav = quickInput(page).locator('.monaco-list-row', { hasText: 'Add to the nav' });
    if (await nav.first().waitFor({ timeout: 2_000 }).then(() => true, () => false)) {
      story.suggest('Criada pelo botão direito numa seção, a página nova ainda pergunta se entra no menu.');
      await click(page, nav.first());
    }
    await expect(page.locator('.tab.active')).toContainText('backup.md', { timeout: 30_000 });
    const editor = await editorOf(page);
    await editor.locator('.ProseMirror').click();
    await toEnd(page);
    await page.keyboard.press('Enter');
    await type(page, 'O backup roda toda noite. Para restaurar, veja a ');
    await type(page, 'seção de erros da API.');
    await save(page);
    await expandRow(page, treeRow(page, 'Operação'));
    await expect(treeRow(page, 'Backup')).toBeVisible();
    const yml = read('mkdocs.yml');
    await story.check('a página entra na seção Operação do menu', async () => expect(yml).toMatch(/- Operação:\n(\s+- .*\n)*\s+- operacao\/backup\.md/));
    await pause(page);
  });

  await story.step('Mover "API" de Referência para Guias', async () => {
    await contextMenu(page, treeRow(page, 'API'), /^Move to/);
    await pick(page, 'Guias');
    await expect(toast(page, /"API" moved to "Guias"/)).toBeVisible();
    const yml = read('mkdocs.yml');
    expect(yml.indexOf('referencia/api.md')).toBeGreaterThan(yml.indexOf('Guias'));
    // A seção Referência ficou vazia
    await story.check('a seção vazia continua na árvore ou some, sem erro no mkdocs.yml', async () => expect(yml).not.toMatch(/Referência:\s*\n\s*-?\s*\n/));
    await story.check('os links continuam iguais (a página não mudou de arquivo)', async () => {
      expect(read('docs/guias/configurar.md')).toContain('(../referencia/api.md#erros)');
      expect(exists('docs/referencia/api.md')).toBe(true);
    });
    await pause(page);
  });

  await story.step('Duplicar "Configurar" e excluir a cópia; depois desfazer a exclusão', async () => {
    await contextMenu(page, treeRow(page, 'Configurar'), 'Duplicate');
    if (!(await quickInput(page).locator('input').waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
      story.bug('Botão direito › Duplicate em "Configurar" (com "API" ainda selecionada do passo anterior) não fez nada: nenhuma pergunta, nenhuma cópia.');
      await click(page, treeRow(page, 'Configurar'));
      await contextMenu(page, treeRow(page, 'Configurar'), 'Duplicate');
    }
    await answer(page, 'Configurar avançado');
    await expect(treeRow(page, 'Configurar avançado')).toBeVisible();
    const copy = 'docs/guias/configurar-avancado.md';
    await story.check('a cópia é um arquivo novo ao lado', async () => expect(exists(copy)).toBe(true));
    await story.check('a cópia tem o título novo', async () => expect(read(copy)).toMatch(/^# Configurar avançado/));
    await story.check('os links relativos da cópia continuam funcionando', async () => expect(read(copy)).toContain('(../referencia/api.md#erros)'));
    await contextMenu(page, treeRow(page, 'Configurar avançado'), /^Delete(?! Section)/);
    await confirm(page, /^Delete$/);
    await expect(treeRow(page, 'Configurar avançado')).toHaveCount(0);
    expect(exists(copy)).toBe(false);
    const message = toast(page, /"Configurar avançado" deleted/);
    await expect(message).toBeVisible();
    await click(page, message.locator('.monaco-button', { hasText: 'Undo' }));
    await expect(treeRow(page, 'Configurar avançado')).toBeVisible();
    expect(exists(copy)).toBe(true);
    await pause(page);
  });

  await story.step('Excluir "Instalar", que tem links apontando para ela: a extensão avisa', async () => {
    await contextMenu(page, treeRow(page, 'Instalar'), /^Delete(?! Section)/);
    const dialog = page.locator('.monaco-dialog-box');
    await expect(dialog).toBeVisible();
    await story.check('o aviso cita as páginas com link para ela', () => expect(dialog).toContainText(/link/));
    await confirm(page, /Cancel/);
    expect(exists('docs/guias/instalar.md')).toBe(true);
    await pause(page);
  });

  await story.step('Filtrar as páginas: "conf"', async () => {
    await sidebarAction(page, 'Filter Pages');
    await type(page, 'conf');
    await page.waitForTimeout(800);
    const labels = await treeRows(page).locator('.label-name').allTextContents();
    if (labels.includes('Backup')) {
      story.suggest('"Filter Pages" abre a busca da árvore do VS Code em modo destaque: as páginas com "conf" ficam marcadas, mas as outras continuam todas na árvore (só somem ligando o filtro na própria caixa). Para quem pediu "filtrar", parece que não funcionou.');
    } else story.ok('O filtro deixa só as páginas que batem.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await story.check('Esc tira o filtro e a árvore volta inteira', () => expect(treeRow(page, 'Backup')).toBeVisible());
    await pause(page);
  });

  await story.step('Apagar a seção Referência, agora vazia', async () => {
    const section = treeRow(page, 'Referência');
    if (!(await section.isVisible())) {
      story.ok('A seção Referência sumiu sozinha quando ficou vazia.');
      return;
    }
    await contextMenu(page, section, 'Delete Section');
    if (await page.locator('.monaco-dialog-box').isVisible()) await confirm(page, /Delete|Only the section/);
    await expect(treeRow(page, 'Referência')).toHaveCount(0);
    expect(read('mkdocs.yml')).not.toContain('Referência');
    await pause(page);
  });

  await story.step('Ctrl+Z na árvore desfaz a última mudança do menu', async () => {
    const before = read('mkdocs.yml');
    // O desfazer da árvore é o Ctrl+Z com o foco nela (fica fora da paleta)
    await click(page, treeRow(page, 'Início'));
    await page.locator('.part.sidebar .monaco-list').first().focus();
    await page.keyboard.press('Control+Z');
    await story.check('o menu volta ao que era antes da última mudança', () => expect.poll(() => read('mkdocs.yml')).not.toBe(before));
    await pause(page);
  });

  await story.step('Os links da página inicial ainda abrem as páginas certas', async () => {
    const editor = await openFromTree(page, 'Início', 'Manual da Loja');
    await expect(editor.locator('.ProseMirror a', { hasText: 'API' })).toHaveAttribute('href', 'referencia/api.md');
    await pause(page);
  });

  await story.step('O site gera com o MkDocs, sem link quebrado', async () => {
    const result = buildSite(folder);
    if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
  });
});
