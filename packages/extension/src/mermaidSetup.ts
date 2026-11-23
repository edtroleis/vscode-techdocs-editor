import * as vscode from 'vscode';
import { addMermaidFence } from '@edtroleis/techdocs-editor-core';
import type { LocalSites } from './localSites';
import { currentText, replaceText, showMessage, type Ask } from './repoCheck';

/**
 * Diagrama inserido no editor visual (spec 06, M7): se o site da página ainda não configura o Mermaid, acrescenta a
 * configuração ao `mkdocs.yml` e avisa, com **Desfazer**. Página fora de um site, ou site já configurado: nada.
 */
export async function configureMermaid(page: vscode.Uri, sites: LocalSites, ask: Ask = showMessage): Promise<void> {
  const site = sites.siteOf(page);
  if (!site) return;
  const mkdocs = sites.all().find(entry => entry.site.root === site.root && entry.site.docsDir === site.docsDir)?.mkdocs;
  if (!mkdocs) return;
  const before = await currentText(mkdocs);
  if (before === undefined) return;
  const after = addMermaidFence(before);
  if (after === before) return;
  await replaceText(mkdocs, after);
  const undo = vscode.l10n.t('Undo');
  const choice = await ask('info', vscode.l10n.t('Configured Mermaid diagrams in {0}.', vscode.workspace.asRelativePath(mkdocs, false)), undo);
  if (choice === undo && (await currentText(mkdocs)) === after) await replaceText(mkdocs, before);
}
