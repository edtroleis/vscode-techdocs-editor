import * as vscode from 'vscode';
import { VisualEditorProvider } from './visualEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new VisualEditorProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VisualEditorProvider.viewType, provider, {
      // Trocar de aba recriaria o editor e perderia cursor e rolagem
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand('techdocsEditor.openVisual', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, VisualEditorProvider.viewType);
    }),
    vscode.commands.registerCommand('techdocsEditor.openText', (uri?: vscode.Uri) => {
      const target = uri ?? activeCustomEditorUri();
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, 'default', vscode.ViewColumn.Beside);
    }),
  );
  // Usado pelos testes de integração (test/vscode)
  return { provider };
}

function activeCustomEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

export function deactivate() {}
