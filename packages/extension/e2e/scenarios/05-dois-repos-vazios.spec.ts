/**
 * Cenário 5: o workspace é o diretório dos repositórios (como o ~/code), com dois repos vazios, mkdocs-empty-local
 * e mkdocs-empty-remote. A pessoa trabalha pelo Explorer do VS Code e pela seção TechDocs dentro dele: cria a
 * documentação de um num clique e a do outro por template, escreve páginas, organiza o menu, mexe nos arquivos pelo
 * Explorer (o menu e os links acompanham), traz o README para o site, troca de um repo para o outro e confere que os
 * dois sites geram.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { click, expect, folderFrom, pause, test, type } from './story';
import { buildSite, contextMenu, editorOf, palette, previewPanel, quickInput, save } from './ui';

const code = folderFrom(undefined, 'code');
for (const repo of ['mkdocs-empty-local', 'mkdocs-empty-remote']) mkdirSync(join(code, repo), { recursive: true });
const LOCAL = join(code, 'mkdocs-empty-local');
const REMOTE = join(code, 'mkdocs-empty-remote');
const read = (path: string) => readFileSync(join(code, path), 'utf8');
/** O arquivo, quando a extensão terminar de gravar ('' antes). */
const written = (path: string) =>
  expect.poll(() => {
    try {
      return read(path);
    } catch {
      return '';
    }
  });
const gone = (path: string) => expect.poll(() => existsSync(join(code, path)));

/** A seção TechDocs dentro do Explorer. */
const techdocs = (page: Page) => page.locator('.pane', { has: page.locator('.pane-header', { hasText: /^TechDocs/ }) });
const docRow = (page: Page, label: string | RegExp) =>
  techdocs(page)
    .locator('.monaco-list-row')
    .filter({ has: page.locator('.label-name', { hasText: typeof label === 'string' ? new RegExp(`^${label}$`) : label }) })
    .first();
/** Uma linha da lista de arquivos do Explorer. */
const fileRow = (page: Page, name: string) =>
  page.locator('.explorer-folders-view .monaco-list-row').filter({ has: page.locator('.label-name', { hasText: new RegExp(`^${name.replace(/\./g, '\\.')}$`) }) }).first();
const toast = (page: Page, text: string | RegExp) => page.locator('.notification-toast', { hasText: text }).last();

/** Abre o diretório no Explorer (clica só se ainda está fechado). */
/**
 * Aumenta a seção TechDocs no Explorer: puxa a divisória de cima dela até o meio da tela. Com a lista de arquivos
 * ocupando tudo, a seção mostra 4 linhas e o cabeçalho fixo e a dica do mouse cobrem as linhas.
 */
async function roomForTechDocs(page: Page) {
  const header = techdocs(page).locator('.pane-header');
  const box = (await header.boundingBox())!;
  if (box.y < 450) return;
  await page.mouse.move(box.x + box.width / 2, box.y - 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, 420, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await header.boundingBox())!.y).toBeLessThan(450);
}

async function expand(page: Page, row: Locator) {
  await expect(row).toBeVisible();
  if ((await row.getAttribute('aria-expanded')) === 'false') await click(page, row);
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}

/** Escolhe o item da lista rápida pelo texto (digitando para filtrar, como a pessoa). */
async function pick(page: Page, text: string | RegExp, filter?: string) {
  await expect(quickInput(page)).toBeVisible();
  if (filter) await type(page, filter);
  const row = quickInput(page).locator('.monaco-list-row', { hasText: text }).first();
  await expect(row).toBeVisible();
  await click(page, row);
}

/** Responde a caixa de texto do VS Code (o que já vem escrito é trocado quando `value` é dado). */
async function answer(page: Page, value?: string, prompt?: RegExp) {
  const input = quickInput(page).locator('input');
  await expect(input).toBeVisible();
  // Uma caixa logo depois da outra: o Enter só vai quando a pergunta nova já está na tela
  if (prompt) await expect(quickInput(page)).toContainText(prompt);
  await expect(input).toBeFocused();
  if (value !== undefined) {
    // A caixa pode ainda estar recebendo o valor inicial: confere o que ficou escrito antes do Enter
    await expect(async () => {
      await input.focus();
      await page.keyboard.press('Control+A');
      await type(page, value);
      await expect(input).toHaveValue(value, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
  }
  await page.keyboard.press('Enter');
}

/** O botão de uma caixa de confirmação do VS Code (as modais desenhadas por ele, `window.dialogStyle` custom). */
async function confirm(page: Page, button: RegExp) {
  const dialog = page.locator('.monaco-dialog-box');
  await expect(dialog).toBeVisible();
  const choice = dialog.getByRole('button', { name: button }).first();
  await click(page, choice);
  // Outra caixa pode vir logo depois (a do VS Code pedindo para a extensão acertar o menu): espera só esta sumir
  await expect(choice).toHaveCount(0);
}

/** Nova página em branco pelo botão direito no item da árvore (o site ou uma seção). */
async function newPage(page: Page, on: Locator, title: string) {
  await contextMenu(page, on, /^New page from template/);
  await pick(page, 'Blank page');
  await answer(page, title);
  // O arquivo sugerido pelo título
  await answer(page, undefined, /File of the new page/);
  await pick(page, 'Add to the nav');
  await expect(page.locator('.tab.active')).toContainText('.md', { timeout: 30_000 });
}

test.use({
  folder: code,
  settings: { 'window.dialogStyle': 'custom', 'explorer.confirmDragAndDrop': false },
  scenario: {
    id: '05-dois-repos-vazios',
    title: 'Dois repos vazios no ~/code: documentação pelo Explorer e pela seção TechDocs',
    summary:
      'O workspace é o diretório dos repositórios, com mkdocs-empty-local e mkdocs-empty-remote vazios. A pessoa cria a documentação de um num clique e a do outro por template, escreve páginas, organiza o menu (seção, renomear, mover, excluir e desfazer), mexe nos arquivos pelo Explorer do VS Code com o menu e os links acompanhando, traz o README para o site, troca de um repo para o outro e confere que os dois sites geram.',
  },
});

test('dois repos vazios: documentação pelo Explorer e pela seção TechDocs', async ({ vscode: { page }, story }) => {
  await story.step('No Explorer, os dois repos vazios e a seção TechDocs embaixo dos arquivos', async () => {
    await page.keyboard.press('Control+Shift+E');
    await expect(fileRow(page, 'mkdocs-empty-local')).toBeVisible({ timeout: 30_000 });
    await expect(fileRow(page, 'mkdocs-empty-remote')).toBeVisible();
    await story.check('a seção TechDocs aparece no Explorer sem abrir o ícone do TechDocs', () => expect(techdocs(page)).toBeVisible({ timeout: 30_000 }));
    await pause(page);
  });

  await story.step('Clique direito em mkdocs-empty-local › Open in TechDocs: a seção oferece criar a documentação', async () => {
    await contextMenu(page, fileRow(page, 'mkdocs-empty-local'), 'Open in TechDocs');
    await expect(techdocs(page).getByRole('button', { name: 'Create the documentation' })).toBeVisible({ timeout: 30_000 });
    await story.check('o nome do diretório no título da seção', () => expect(techdocs(page).locator('.pane-header')).toContainText('mkdocs-empty-local'));
    await pause(page);
  });

  let home = '';
  await story.step('Create the documentation: um clique cria o mkdocs.yml e a página inicial', async () => {
    const started = Date.now();
    await click(page, techdocs(page).getByRole('button', { name: 'Create the documentation' }));
    await written('mkdocs-empty-local/mkdocs.yml').toContain('site_name:');
    await written('mkdocs-empty-local/docs/index.md').toMatch(/^# /);
    home = read('mkdocs-empty-local/docs/index.md').split('\n')[0].replace(/^# /, '');
    await expect(docRow(page, 'mkdocs-empty-local')).toBeVisible({ timeout: 30_000 });
    await expect(docRow(page, home)).toBeVisible();
    const seconds = (Date.now() - started) / 1000;
    if (seconds > 5) story.suggest(`Criar a documentação num clique levou ${seconds.toFixed(1)} s até a árvore mostrar o site.`);
    await story.check('sem catalog-info.yaml (o repo não usa Backstage)', async () => expect(existsSync(join(LOCAL, 'catalog-info.yaml'))).toBe(false));
    await pause(page);
  });

  await story.step('Escrever a página inicial', async () => {
    await click(page, docRow(page, home));
    const editor = await editorOf(page);
    await editor.locator('.ProseMirror h1').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, 'Documentação do repositório local, sem GitHub.');
    await save(page);
    expect(read('mkdocs-empty-local/docs/index.md')).toContain('Documentação do repositório local, sem GitHub.');
    await pause(page);
  });

  await story.step('Nova página "Primeiros passos" pelo botão direito no site', async () => {
    await roomForTechDocs(page);
    await newPage(page, docRow(page, 'mkdocs-empty-local'), 'Primeiros passos');
    await written('mkdocs-empty-local/docs/primeiros-passos.md').toMatch(/^# Primeiros passos/);
    await written('mkdocs-empty-local/mkdocs.yml').toContain('primeiros-passos.md');
    await expect(docRow(page, 'Primeiros passos')).toBeVisible();
    await pause(page);
  });

  await story.step('Nova seção "Guias": começa com uma página de mesmo nome', async () => {
    await contextMenu(page, docRow(page, 'mkdocs-empty-local'), 'New Section');
    await answer(page, 'Guias');
    await written('mkdocs-empty-local/docs/guias/index.md').toMatch(/^# Guias/);
    await written('mkdocs-empty-local/mkdocs.yml').toContain('Guias:');
    await expect(docRow(page, 'Guias')).toBeVisible();
    await pause(page);
  });

  await story.step('Nova página "Como publicar" dentro da seção Guias', async () => {
    await newPage(page, docRow(page, 'Guias'), 'Como publicar');
    await written('mkdocs-empty-local/docs/guias/como-publicar.md').toMatch(/^# Como publicar/);
    await story.check('a página entra na seção Guias do menu', async () => expect(read('mkdocs-empty-local/mkdocs.yml')).toMatch(/Guias:\n(\s+- .*\n)*\s+- guias\/como-publicar\.md/));
    await pause(page);
  });

  await story.step('Renomear "Primeiros passos" para "Comece aqui" (o título 1 muda junto)', async () => {
    await contextMenu(page, docRow(page, 'Primeiros passos'), /^Rename/);
    await answer(page, 'Comece aqui');
    await expect(docRow(page, 'Comece aqui')).toBeVisible();
    await written('mkdocs-empty-local/docs/primeiros-passos.md').toMatch(/^# Comece aqui/);
    await pause(page);
  });

  await story.step('Descer "Comece aqui" para depois de Guias', async () => {
    const before = read('mkdocs-empty-local/mkdocs.yml');
    expect(before.indexOf('primeiros-passos.md')).toBeLessThan(before.indexOf('Guias'));
    // Na página, o botão direito tem "Move to…" (Mover para baixo direto fica só nas seções)
    await contextMenu(page, docRow(page, 'Comece aqui'), /^Move to/);
    await pick(page, /Down/);
    await expect.poll(() => read('mkdocs-empty-local/mkdocs.yml').indexOf('primeiros-passos.md')).toBeGreaterThan(read('mkdocs-empty-local/mkdocs.yml').indexOf('Guias'));
    await pause(page);
  });

  await story.step('Excluir "Comece aqui" e desfazer pelo aviso', async () => {
    await contextMenu(page, docRow(page, 'Comece aqui'), /^Delete/);
    await confirm(page, /^Delete/);
    await gone('mkdocs-empty-local/docs/primeiros-passos.md').toBe(false);
    await expect(docRow(page, 'Comece aqui')).toHaveCount(0);
    await click(page, toast(page, /deleted/i).getByRole('button', { name: 'Undo' }));
    await gone('mkdocs-empty-local/docs/primeiros-passos.md').toBe(true);
    await expect(docRow(page, 'Comece aqui')).toBeVisible();
    await written('mkdocs-empty-local/mkdocs.yml').toContain('primeiros-passos.md');
    await pause(page);
  });

  await story.step('No Explorer, F2 em primeiros-passos.md: mover para guias/ pelo nome; o menu e os links acompanham', async () => {
    // Um link para a página, para ver o link acompanhar
    await click(page, docRow(page, home));
    const homeTab = page.locator('.tab.active', { hasText: 'index.md' });
    if (!(await homeTab.waitFor({ timeout: 5_000 }).then(() => true, () => false))) {
      // Visto 1 vez: a linha ficou selecionada e a página não abriu (a árvore se redesenhando no clique?)
      story.bug(`Clique em "${home}" na árvore selecionou a linha mas não abriu a página.`);
      await click(page, docRow(page, home));
      await homeTab.waitFor();
    }
    const editor = await editorOf(page);
    await editor.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await type(page, ' Veja ');
    await editor.locator('.top-bar-item').nth(7).click();
    const option = editor.locator('.docs-link-pages [role=option]', { hasText: 'Comece aqui' });
    await expect(option).toBeVisible();
    await click(page, option);
    await save(page);
    expect(read('mkdocs-empty-local/docs/index.md')).toContain('](primeiros-passos.md)');

    await expand(page, fileRow(page, 'mkdocs-empty-local'));
    await expand(page, fileRow(page, 'docs'));
    await click(page, fileRow(page, 'primeiros-passos.md'));
    await page.keyboard.press('F2');
    const input = page.locator('.explorer-folders-view .monaco-inputbox input');
    await expect(input).toBeVisible();
    await page.keyboard.press('Control+A');
    await type(page, 'guias/primeiros-passos.md');
    await page.keyboard.press('Enter');
    // O VS Code pergunta antes de deixar uma extensão mexer em outros arquivos junto com a mudança
    const ask = page.locator('.monaco-dialog-box', { hasText: 'wants to make refactoring changes' });
    if (await ask.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
      story.suggest('Ao mover pelo Explorer, o VS Code pergunta "TechDocs Editor wants to make refactoring changes with this file move" (OK / Show Preview / Skip Changes). É a confirmação do próprio VS Code; marcar "Do not ask me again" tira a pergunta.');
      await click(page, ask.getByRole('button', { name: 'OK' }));
    }
    await gone('mkdocs-empty-local/docs/guias/primeiros-passos.md').toBe(true);
    await story.check('o menu acompanha a página movida', () => written('mkdocs-empty-local/mkdocs.yml').toContain('guias/primeiros-passos.md'));
    await story.check('o link da página inicial acompanha', () => written('mkdocs-empty-local/docs/index.md').toContain('](guias/primeiros-passos.md)'));
    await story.check('o aviso diz o que foi atualizado, com Desfazer', () => expect(toast(page, /moved/)).toContainText('Also updated'));
    await pause(page);
  });

  await story.step('Desfazer pelo aviso: a página, o menu e o link voltam', async () => {
    await click(page, toast(page, /moved/).getByRole('button', { name: 'Undo' }));
    await gone('mkdocs-empty-local/docs/primeiros-passos.md').toBe(true);
    // O Desfazer não pede a confirmação do VS Code de novo
    await expect(page.locator('.monaco-dialog-box')).toHaveCount(0);
    await written('mkdocs-empty-local/mkdocs.yml').not.toContain('guias/primeiros-passos.md');
    await written('mkdocs-empty-local/docs/index.md').toContain('](primeiros-passos.md)');
    await pause(page);
  });

  await story.step('No Explorer, excluir guias/como-publicar.md: a página sai do menu', async () => {
    await expand(page, fileRow(page, 'guias'));
    await click(page, fileRow(page, 'como-publicar.md'));
    await page.keyboard.press('Delete');
    await confirm(page, /Move to Trash|Delete/);
    const ask = page.locator('.monaco-dialog-box', { hasText: 'wants to make refactoring changes' });
    if (await ask.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) await click(page, ask.getByRole('button', { name: 'OK' }));
    await gone('mkdocs-empty-local/docs/guias/como-publicar.md').toBe(false);
    await story.check('a página sai do menu', () => written('mkdocs-empty-local/mkdocs.yml').not.toContain('como-publicar.md'));
    await story.check('o aviso diz que saiu do menu', () => expect(toast(page, /deleted/)).toContainText('menu'));
    await expect(docRow(page, 'Como publicar')).toHaveCount(0);
    await pause(page);
  });

  await story.step('Clique direito no README.md › Copy to a Page: o README vira uma página do site', async () => {
    writeFileSync(join(LOCAL, 'README.md'), '# Sobre o repositório\n\nComo contribuir com a documentação.\n');
    story.outside('O README.md foi escrito fora da extensão (como já estaria no repositório).');
    await expect(fileRow(page, 'README.md')).toBeVisible();
    await contextMenu(page, fileRow(page, 'README.md'), 'Copy to a Page');
    await answer(page);
    await written('mkdocs-empty-local/docs/sobre-o-repositorio.md').toContain('Como contribuir');
    await written('mkdocs-empty-local/mkdocs.yml').toContain('sobre-o-repositorio.md');
    await expect(docRow(page, 'Sobre o repositório')).toBeVisible();
    await pause(page);
  });

  await story.step('Trocar para mkdocs-empty-remote pela paleta (Switch Directory or Repo…)', async () => {
    await palette(page, 'TechDocs: Switch Directory or Repo');
    await pick(page, 'mkdocs-empty-remote');
    await pick(page, 'Use this folder');
    await expect(techdocs(page).getByRole('button', { name: /Choose a template/ })).toBeVisible({ timeout: 30_000 });
    await pause(page);
  });

  await story.step('Escolher um template: o painel Nova documentação, e Criar', async () => {
    await click(page, techdocs(page).getByRole('button', { name: /Choose a template/ }));
    const panel = await previewPanel(page);
    await expect(panel.locator('#f-siteName')).toHaveValue(/mkdocs empty remote/i);
    await story.check('o catalog-info.yaml vem desmarcado', () => expect(panel.getByLabel('Include catalog-info.yaml')).not.toBeChecked());
    await click(page, panel.getByRole('button', { name: 'Create' }));
    await written('mkdocs-empty-remote/mkdocs.yml').toContain('site_name:');
    await written('mkdocs-empty-remote/docs/index.md').toMatch(/^# /);
    await story.check('sem catalog-info.yaml', async () => expect(existsSync(join(REMOTE, 'catalog-info.yaml'))).toBe(false));
    // Pela paleta: com o foco no editor visual que abriu, o Ctrl+Shift+E fica no webview
    await palette(page, 'View: Show Explorer');
    await expect(docRow(page, 'mkdocs-empty-remote')).toBeVisible({ timeout: 30_000 });
    await pause(page);
  });

  await story.step('Escrever na página inicial do remote', async () => {
    const title = read('mkdocs-empty-remote/docs/index.md').split('\n')[0].replace(/^# /, '');
    await click(page, docRow(page, title));
    const editor = await editorOf(page);
    await editor.locator('.ProseMirror h1').first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, 'Este repositório vai para o GitHub.');
    await save(page);
    expect(read('mkdocs-empty-remote/docs/index.md')).toContain('Este repositório vai para o GitHub.');
    await pause(page);
  });

  await story.step('Voltar ao local pelo Explorer (Open in TechDocs): o menu dele, como ficou', async () => {
    await contextMenu(page, fileRow(page, 'mkdocs-empty-local'), 'Open in TechDocs');
    await expect(docRow(page, 'mkdocs-empty-local')).toBeVisible({ timeout: 30_000 });
    for (const label of ['Comece aqui', 'Guias', 'Sobre o repositório']) await expect(docRow(page, label)).toBeVisible();
    await expect(docRow(page, 'mkdocs-empty-remote')).toHaveCount(0);
    await pause(page);
  });

  await story.step('Os dois sites geram com o MkDocs (como na pipeline do TechDocs)', async () => {
    for (const folder of [LOCAL, REMOTE]) {
      const result = buildSite(folder);
      if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
      await story.check(`mkdocs build --strict sem erros em ${folder.split('/').pop()}`, async () => expect(result.ok, result.output).toBe(true));
    }
  });
});
