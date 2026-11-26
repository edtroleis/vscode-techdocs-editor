/**
 * O README compara a mesma tarefa sem e com a extensão: uma página nova na seção Guides, com passos e uma imagem, no
 * menu do site, mandada para revisão. "Sem" é o VS Code puro (a extensão nem carrega): Markdown à mão, o caminho da
 * imagem à mão, o `nav` do mkdocs.yml à mão e o git no terminal. "Com" é a árvore, o editor visual e o botão Enviar.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { caption, clickLike, hoverLike, overlay, pause, typeSlowly } from '../human';
import { contextMenu, editorOf, expandRow, publishStrip, techdocsIcon, treeRow } from '../scenarios/ui';
import { expect, runCommand, test } from '../vscode';
import { markStart, OUT, paymentsSite, SIZE } from './shared';

const PNG = join(__dirname, '../../test/fixtures/wiki/docs/assets/diagrama.png');

/**
 * O site de exemplo como um clone do GitHub: o `origin` é github.com, redirecionado (`insteadOf`, só neste repositório)
 * para um repositório bare local. A imagem fica fora do repositório, como um arquivo do computador.
 */
function clonedSite() {
  const folder = paymentsSite();
  const bare = mkdtempSync(join(tmpdir(), 'techdocs-video-remote-'));
  const origin = 'https://github.com/acme/payments-service.git';
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' });
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Ana Souza');
  git('config', 'user.email', 'ana@example.com');
  git('config', `url.${bare}.insteadOf`, origin);
  git('add', '-A');
  git('commit', '-m', 'docs: payments service');
  git('remote', 'add', 'origin', origin);
  git('push', '-u', 'origin', 'main');
  copyFileSync(PNG, join(folder, '..', 'rollback-flow.png'));
  return folder;
}

/** O terminal sem o .bashrc de quem grava: o prompt não mostra usuário, máquina nem caminho. */
const TERMINAL = {
  'terminal.integrated.profiles.linux': { demo: { path: 'bash', args: ['--norc', '--noprofile'] } },
  'terminal.integrated.defaultProfile.linux': 'demo',
  'terminal.integrated.env.linux': { PS1: 'payments-service $ ' },
  'terminal.integrated.shellIntegration.enabled': false,
};

const scene = (name: string, devExtension: boolean) => ({ recordDir: join(OUT, name), windowSize: SIZE, folder: clonedSite(), devExtension, settings: TERMINAL });

const explorerRow = (page: Page, name: string) => page.locator('.explorer-folders-view .monaco-list-row', { has: page.locator('.label-name', { hasText: new RegExp(`^${name}$`) }) });

test.describe('without-extension', () => {
  test.use(scene('without-extension', false));
  test('sem a extensão: Markdown, nav e git à mão', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await expect(explorerRow(page, 'docs')).toBeVisible({ timeout: 60_000 });
    markStart('without-extension', startedAt);
    await caption(page, 'Without the extension: create the file in the right folder');
    await clickLike(page, explorerRow(page, 'docs'));
    await clickLike(page, explorerRow(page, 'guides'));
    await page.locator('.explorer-viewlet .pane-header').first().hover();
    await clickLike(page, page.locator('.explorer-viewlet .action-label[aria-label^="New File"]'));
    await typeSlowly(page, 'roll-back.md');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tab.active')).toContainText('roll-back.md', { timeout: 30_000 });
    await caption(page, 'Write Markdown by hand, and the image path too (copy the image into docs first)');
    await typeSlowly(page, '# Roll back\n\n## Steps\n\n1. Deploy the previous version\n2. Check the health page\n\n![Rollback flow](../images/rollback-flow.png');
    await page.keyboard.press('Control+S');
    await pause(page, 1_000);
    await caption(page, 'Add the page to the menu in mkdocs.yml, with the right indentation');
    await clickLike(page, explorerRow(page, 'mkdocs.yml'));
    await expect(page.locator('.tab.active')).toContainText('mkdocs.yml');
    await page.keyboard.press('Control+G');
    await page.keyboard.type('8');
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await typeSlowly(page, '- Roll back: guides/roll-back.md');
    await page.keyboard.press('Control+S');
    await pause(page, 1_200);
    await caption(page, 'Then git in the terminal: branch, commit, push…');
    await runCommand(page, 'Terminal: Create New Terminal');
    await pause(page, 2_000);
    for (const command of ['git switch -c docs/roll-back', 'git add -A', 'git commit -m "docs: roll back guide"', 'git push -u origin docs/roll-back']) {
      await typeSlowly(page, command);
      await page.keyboard.press('Enter');
      await pause(page, 1_200);
    }
    await caption(page, '…and open the pull request on GitHub');
    await pause(page, 3_000);
  });
});

test.describe('with-extension', () => {
  test.use(scene('with-extension', true));
  test('com a extensão: árvore, editor visual e Enviar', async ({ vscode: { page, startedAt } }) => {
    await overlay(page);
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 60_000 });
    markStart('with-extension', startedAt);
    await caption(page, 'With the extension: the site menu, as readers see it');
    await clickLike(page, techdocsIcon(page));
    await expect(treeRow(page, 'Home')).toBeVisible({ timeout: 30_000 });
    await expandRow(page, treeRow(page, 'Guides'));
    await caption(page, 'A new page right in the section: it goes into the menu');
    await contextMenu(page, treeRow(page, 'Guides'), 'New Page in This Section');
    await expect(page.locator('.tab.active')).toContainText('new-page', { timeout: 30_000 });
    const editor = await editorOf(page);
    await pause(page, 800);
    await typeSlowly(page, 'Roll back');
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tab.active')).toContainText('roll-back.md', { timeout: 30_000 });
    await expect(treeRow(page, 'Roll back')).toBeVisible();
    await caption(page, 'Write like a document; / for lists, images and more');
    const last = editor.locator('.ProseMirror > :is(p, h1, h2, h3)').last();
    await clickLike(page, last);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await typeSlowly(page, '/numbered');
    await pause(page, 900);
    await page.keyboard.press('Enter');
    await typeSlowly(page, 'Deploy the previous version');
    await page.keyboard.press('Enter');
    await typeSlowly(page, 'Check the health page');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await caption(page, 'An image from the computer: saved to docs/images and linked for you');
    await typeSlowly(page, '/image');
    await pause(page, 900);
    await page.keyboard.press('Enter');
    const block = editor.locator('.milkdown-image-block');
    const chooser = page.waitForEvent('filechooser');
    await clickLike(page, block.locator('label.uploader'));
    await (await chooser).setFiles({ name: 'Rollback flow.png', mimeType: 'image/png', buffer: readFileSync(PNG) });
    await expect(block.locator('img')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Control+S');
    await pause(page, 1_000);
    await caption(page, 'Send: one button for the branch, the commit and the pull request');
    await expect(publishStrip(editor)).toContainText('changes to send', { timeout: 30_000 });
    // Sem clicar: o Enviar de verdade pede o login do GitHub, que a gravação não tem
    await hoverLike(page, publishStrip(editor).getByRole('button', { name: /^Send \(\d+\)$/ }));
    await pause(page, 3_500);
  });
});
