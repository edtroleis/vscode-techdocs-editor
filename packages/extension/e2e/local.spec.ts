/**
 * Modo local (spec 02): arquivo com conflito do Git não abre no editor visual (LC4).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, openFile, openVisualCommand, runCommand, test, visual } from './vscode';

test('arquivo com conflito mostra o aviso, e "Abrir como texto" troca o visual pelo texto', async ({
  vscode: { page, workspace },
}) => {
  // Numa pasta de docs: o comando do editor visual só aparece nas páginas das docs
  mkdirSync(join(workspace, 'wiki/docs/conflito'), { recursive: true });
  writeFileSync(
    join(workspace, 'wiki/docs/conflito', 'pagina.md'),
    '# Conflito\n\n<<<<<<< HEAD\nTexto meu.\n=======\nTexto deles.\n>>>>>>> main\n',
  );
  await openFile(page, 'wiki/docs/conflito/pagina.md');
  await openVisualCommand(page);

  const notice = visual(page).locator('.conflict');
  await expect(notice).toContainText('conflict markers');
  await expect(visual(page).locator('.milkdown')).toHaveCount(0);

  await notice.getByRole('button', { name: 'Open as text' }).click();
  // O texto toma o lugar do visual: uma aba só, a de texto, com os marcadores à vista
  await expect(page.locator('.tab', { hasText: 'pagina.md' })).toHaveCount(1);
  await expect(page.locator('.monaco-editor .view-lines').last()).toContainText('<<<<<<< HEAD');
  await expect(page.locator('iframe.webview.ready')).toHaveCount(0);
});
