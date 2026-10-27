/**
 * Lint e "Ver linha" no VS Code de verdade (spec 01, L-3, L-4, W11 e W12).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, openVisual, runCommand, save, test, visual } from './vscode';

const PAGE = 'wiki/docs/index.md';

test('problema na lista do visual, no painel Problemas; "Ajustar agora" corrige', async ({
  vscode: { page, workspace, file },
}) => {
  appendFileSync(join(workspace, PAGE), '\n# Seção extra\n\nTexto da seção.\n');
  const line = readFileSync(join(workspace, PAGE), 'utf8').split('\n').indexOf('# Seção extra') + 1;
  await openVisual(page, PAGE);

  const problems = visual(page).locator('.problems');
  await expect(problems.locator('summary')).toHaveText('1 formatting problem');
  await expect(problems.locator('li')).toContainText(`Line ${line}`);
  await expect(problems.locator('li')).toContainText('more than one Heading 1');
  await expect(visual(page).locator('.docs-editor-problem')).toHaveText(`● ${line}`);

  await runCommand(page, 'Problems: Focus on Problems View');
  await expect(page.locator('.markers-panel')).toContainText('more than one Heading 1');

  await problems.getByRole('button', { name: 'Fix automatically' }).click();
  await expect(problems).toHaveCount(0);
  await expect(page.locator('.markers-panel')).not.toContainText('more than one Heading 1');
  await visual(page).locator('.milkdown').click();
  await save(page);
  await expect.poll(() => file(PAGE)).toContain('\n## Seção extra\n');
});

test('"Ver linha": o número ao lado do bloco abre o texto ao lado, com o cursor na linha', async ({
  vscode: { page, file },
}) => {
  const lines = file(PAGE).split('\n');
  const line = lines.indexOf('## Como editar') + 1;
  await openVisual(page, PAGE);
  await visual(page).locator('.docs-editor-line', { hasText: new RegExp(`^${line}$`) }).click();
  // Editor de texto ao lado, com o cursor no começo da linha
  await expect(page.locator('.editor-group-container')).toHaveCount(2);
  await expect(page.locator('.statusbar-item', { hasText: /^Ln \d+, Col \d+$/ })).toHaveText(`Ln ${line}, Col 1`);
  await expect(page.locator('.monaco-editor .view-lines').last()).toContainText('## Como editar');
});
