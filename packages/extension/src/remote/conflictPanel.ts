import * as vscode from 'vscode';
import { ConflictChoice, conflictCount, MergeChunk, pageTitle, resolveChunks } from '@edtroleis/techdocs-editor-core';
import type { RemoteFileSystem } from './remoteFs';

/** O que o webview da resolução manda: as escolhas (na ordem dos trechos) ou cancelar. */
export type ConflictMessage = { type: 'ready' } | { type: 'done'; choices: ConflictChoice[] } | { type: 'cancel' };

/**
 * Tela de resolução de conflito (M5, D4-6), numa aba: em cada trecho que as duas versões mudaram, a pessoa
 * fica com a outra versão, com a sua ou com as duas; o resto já foi juntado. Como o `ConflictResolver` do
 * plugin, em HTML simples.
 */
export class ConflictPanel {
  /** Testes de integração: escolhas prontas, sem abrir a aba (undefined = cancelar). */
  testChoices: ((chunks: MergeChunk[]) => ConflictChoice[] | undefined) | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Abre a tela para a página `title` e devolve o texto escolhido, ou undefined se a pessoa cancelou.
   * `other`: como chamar a outra versão ("Versão publicada" ou "Versão salva em outra janela").
   */
  resolve(title: string, chunks: MergeChunk[], other: string): Promise<string | undefined> {
    if (this.testChoices) {
      const choices = this.testChoices(chunks);
      return Promise.resolve(choices && resolveChunks(chunks, choices));
    }
    const media = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('techdocsEditor.conflict', vscode.l10n.t('Resolve conflict: {0}', title), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media],
    });
    panel.webview.html = html(panel.webview, media);
    return new Promise(resolve => {
      let done = false;
      const finish = (text: string | undefined) => {
        if (done) return;
        done = true;
        resolve(text);
        panel.dispose();
      };
      panel.onDidDispose(() => finish(undefined));
      panel.webview.onDidReceiveMessage((message: ConflictMessage) => {
        if (message.type === 'ready') {
          void panel.webview.postMessage({ type: 'init', chunks, labels: { ...conflictLabels(), other }, total: conflictCount(chunks) });
        } else if (message.type === 'done') finish(resolveChunks(chunks, message.choices));
        else finish(undefined);
      });
    });
  }
}

/** Título da página para a aba da tela de conflito. */
export function conflictTitle(document: vscode.TextDocument) {
  return pageTitle(document.getText()) ?? document.uri.path.split('/').pop()!.replace(/\.md$/i, '');
}

/**
 * Ctrl+S recusado porque o rascunho mudou em outra janela no mesmo trecho (M5): a tela de conflito abre e o
 * texto escolhido é salvo por cima da versão de agora do rascunho.
 */
export function resolveSaveConflicts(remoteFs: RemoteFileSystem, panel: ConflictPanel): vscode.Disposable {
  return remoteFs.onDidConflict(async ({ uri, error }) => {
    const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (!document) return;
    const text = await panel.resolve(conflictTitle(document), error.chunks, vscode.l10n.t('Version saved in another window'));
    if (text === undefined) return;
    remoteFs.rebase(uri, error.latest);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit);
    await document.save();
  });
}

/** Textos da tela (o webview não tem `vscode.l10n`). */
export function conflictLabels() {
  return {
    title: vscode.l10n.t('This page changed while you were editing it'),
    intro: vscode.l10n.t('Both versions changed the same passages. Choose what stays in each one; the rest was already merged.'),
    nothing: vscode.l10n.t('There is nothing to choose. Finish to merge the two versions.'),
    passage: vscode.l10n.t('Passage {0} of {1}'),
    mine: vscode.l10n.t('Your version'),
    removed: vscode.l10n.t('(passage removed)'),
    keepTheirs: vscode.l10n.t('Keep the other'),
    keepMine: vscode.l10n.t('Keep mine'),
    keepBoth: vscode.l10n.t('Keep both'),
    finish: vscode.l10n.t('Finish'),
    cancel: vscode.l10n.t('Cancel'),
    missing: vscode.l10n.t('{0} passage(s) left to choose'),
  };
}

export type ConflictLabels = ReturnType<typeof conflictLabels> & { other: string };

function html(webview: vscode.Webview, media: vscode.Uri) {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'conflict.js'));
  return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${CONFLICT_CSS}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

const CONFLICT_CSS = `
body { padding: 16px 24px 32px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); max-width: 1100px; }
h1 { font-size: 1.3em; font-weight: 600; margin: 0 0 6px; }
p { margin: 4px 0; }
.muted { color: var(--vscode-descriptionForeground); }
.passage { margin-top: 24px; }
.passage h2 { font-size: 1em; font-weight: 600; margin: 0 0 4px; }
.context { font-family: var(--vscode-editor-font-family); font-size: 0.9em; color: var(--vscode-descriptionForeground); white-space: pre-wrap; margin: 4px 0 8px; }
.versions { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.version { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px 12px; font-family: var(--vscode-editor-font-family); font-size: 0.95em; white-space: pre-wrap; overflow-wrap: anywhere; }
.version.chosen { outline: 2px solid var(--vscode-focusBorder); }
.version h3 { font-family: var(--vscode-font-family); font-size: 0.9em; font-weight: 600; margin: 0 0 6px; }
.empty { font-style: italic; color: var(--vscode-descriptionForeground); }
.choices { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
button { padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; font: inherit;
  color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.footer { display: flex; gap: 8px; align-items: center; margin-top: 28px; }
`;
