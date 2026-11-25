import * as vscode from 'vscode';

/** Configurações do TechDocs: as do VS Code, só as da extensão. */
export function openSettings() {
  return vscode.commands.executeCommand('workbench.action.openSettings', '@ext:edtroleis.techdocs-editor');
}
