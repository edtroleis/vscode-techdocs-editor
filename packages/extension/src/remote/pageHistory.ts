import * as vscode from 'vscode';
import { FileVersion, parseRemoteUri, REMOTE_SCHEME } from '@edtroleis/techdocs-editor-core';
import { gitHubErrorText } from '../publish/githubAuth';
import type { RemoteFileSystem } from './remoteFs';
import type { RemoteRepos } from './remoteRepos';
import { VisualEditorProvider } from '../visualEditorProvider';

/** Testes de integração: a versão escolhida, sem abrir a lista (undefined = cancelar). */
let testPick: ((versions: FileVersion[]) => FileVersion | undefined) | undefined;
export function useTestHistoryPick(pick: typeof testPick) {
  testPick = pick;
}

/**
 * "Histórico da página" (M7) numa página do GitHub: as versões publicadas (commits da branch principal que
 * mudaram o arquivo). Restaurar põe o texto da versão no editor, sem salvar; daí em diante é o fluxo normal
 * (Ctrl+S grava o rascunho, o painel verifica e envia), como no plugin.
 */
export async function showPageHistory(remotes: RemoteRepos, remoteFs: RemoteFileSystem, target?: vscode.Uri) {
  const uri = target ?? activeRemotePage();
  const ref = uri && parseRemoteUri(uri.authority, uri.path);
  const session = uri && remoteFs.session(uri);
  if (!uri || !ref || !session) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Open a page from GitHub to see its history.'));
    return;
  }
  try {
    const access = await remotes.access(ref.host, ref.slug);
    const versions = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: vscode.l10n.t('Reading the page history…') },
      () => access.client.getFileHistory(session.filePath, access.repo.defaultBranch),
    );
    if (!versions.length) {
      void vscode.window.showInformationMessage(vscode.l10n.t('This page has no published versions yet.'));
      return;
    }
    const version = testPick ? testPick(versions) : await pick(versions);
    if (!version) return;
    if (!remoteFs.canSave(uri)) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Sign in to GitHub with write access to restore a version (Publishing panel).'));
      return;
    }
    const file = await access.client.getFile(session.filePath, version.sha);
    const document = await vscode.workspace.openTextDocument(uri);
    if (file?.content === undefined) return;
    if (document.getText() === file.content) {
      void vscode.window.showInformationMessage(vscode.l10n.t('The page already has the text of this version.'));
      return;
    }
    if (document.isDirty && !testPick) {
      const restore = vscode.l10n.t('Restore');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('The page has unsaved changes. Restoring replaces them with the text of this version.'),
        { modal: true },
        restore,
      );
      if (answer !== restore) return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), file.content);
    await vscode.workspace.applyEdit(edit);
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Version of {0} restored in the editor. Save it to keep it in your draft; it is published like any other change.', formatDate(version.date)),
    );
  } catch (error) {
    void vscode.window.showErrorMessage(gitHubErrorText(error, vscode.l10n));
  }
}

async function pick(versions: FileVersion[]): Promise<FileVersion | undefined> {
  const items = versions.map((version, i) => ({
    label: formatDate(version.date),
    description: i === 0 ? vscode.l10n.t('current published version') : undefined,
    detail: [version.title, version.author].filter(Boolean).join(' · '),
    version,
  }));
  const chosen = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Page history'),
    placeHolder: vscode.l10n.t('Choose a published version to restore in the editor'),
    matchOnDetail: true,
  });
  return chosen?.version;
}

/** Data e hora curtas no idioma do VS Code. */
function formatDate(iso: string) {
  return new Date(iso).toLocaleString(vscode.env.language, { dateStyle: 'short', timeStyle: 'short' });
}

/** Página do GitHub ativa: no editor de texto ou no editor visual. */
function activeRemotePage(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri =
    input instanceof vscode.TabInputCustom && input.viewType === VisualEditorProvider.viewType
      ? input.uri
      : vscode.window.activeTextEditor?.document.uri;
  return uri?.scheme === REMOTE_SCHEME && /\.md$/i.test(uri.path) ? uri : undefined;
}
