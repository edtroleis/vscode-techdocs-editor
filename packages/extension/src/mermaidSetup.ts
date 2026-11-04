import * as vscode from 'vscode';
import { addMermaidFence } from '@edtroleis/techdocs-editor-core';
import type { LocalSites } from './localSites';
import type { Ask } from './repoCheck';

const showMessage: Ask = (kind, message, ...items) =>
  kind === 'warning' ? vscode.window.showWarningMessage(message, ...items) : vscode.window.showInformationMessage(message, ...items);

const decoder = new TextDecoder();

/** Texto do arquivo: o do editor aberto (com o que não foi salvo) ou o do disco. */
async function currentText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  return vscode.workspace.fs.readFile(uri).then(bytes => decoder.decode(bytes), () => undefined);
}

/** Troca o texto do arquivo pelo editor (entra no desfazer do VS Code) e salva se ele estava salvo. */
async function replaceText(uri: vscode.Uri, next: string) {
  const document = await vscode.workspace.openTextDocument(uri);
  const wasDirty = document.isDirty;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), next);
  if ((await vscode.workspace.applyEdit(edit)) && !wasDirty) await document.save();
}

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
