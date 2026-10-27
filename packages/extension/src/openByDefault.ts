import * as vscode from 'vscode';
import { hasConflictMarkers } from './docsSite';
import type { LocalSites } from './localSites';

export const VISUAL_VIEW_TYPE = 'techdocsEditor.visual';
export const OPEN_VISUAL_BY_DEFAULT = 'techdocsEditor.openVisualByDefault';

const uriOf = (tab: vscode.Tab) =>
  tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom ? tab.input.uri : undefined;

const isVisual = (tab: vscode.Tab) =>
  tab.input instanceof vscode.TabInputCustom && tab.input.viewType === VISUAL_VIEW_TYPE;

/**
 * Com `techdocsEditor.openVisualByDefault`, página de docs aberta como texto passa para o editor visual
 * (spec 00, A4). Fica no texto quando a mesma página já está aberta no visual (o texto foi pedido ao
 * lado), quando a pessoa acabou de trocar o visual pelo texto ("Reabrir com…") e quando o arquivo tem
 * marcadores de conflito (o visual só mostraria o aviso para abrir o texto).
 */
export function openVisualByDefault(sites: LocalSites): vscode.Disposable {
  /** Páginas que a pessoa preferiu ver como texto nesta sessão. */
  const keepText = new Set<string>();

  return vscode.window.tabGroups.onDidChangeTabs(async ({ opened, closed }) => {
    if (!vscode.workspace.getConfiguration().get<boolean>(OPEN_VISUAL_BY_DEFAULT)) return;
    const closedVisual = new Set(closed.filter(isVisual).map(tab => uriOf(tab)!.toString()));
    for (const tab of opened) {
      if (!(tab.input instanceof vscode.TabInputText)) continue;
      const uri = tab.input.uri;
      const key = uri.toString();
      if (closedVisual.has(key)) keepText.add(key);
      if (keepText.has(key) || !sites.siteOf(uri)) continue;
      const visualOpen = vscode.window.tabGroups.all.some(group =>
        group.tabs.some(other => isVisual(other) && uriOf(other)?.toString() === key),
      );
      if (visualOpen) continue;
      const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === key);
      if (document && hasConflictMarkers(document.getText())) continue;
      await vscode.commands.executeCommand('vscode.openWith', uri, VISUAL_VIEW_TYPE, tab.group.viewColumn);
      const textTab = tab.group.tabs.find(
        other => other.input instanceof vscode.TabInputText && other.input.uri.toString() === key,
      );
      if (textTab) await vscode.window.tabGroups.close(textTab, true);
    }
  });
}
