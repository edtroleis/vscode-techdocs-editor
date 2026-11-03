import * as vscode from 'vscode';
import { DEFAULT_MAX_IMAGE_MB, downloadImage, imageProblem, imageTarget } from './imageUpload';
import type { LocalSites } from './localSites';
import { htmlToMarkdown } from './htmlToMarkdown';

export const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append('markdown', 'techdocs');

/**
 * "Colar como Markdown" no editor de texto (spec 05, C12): o HTML da área de transferência vira Markdown, com as
 * imagens copiadas para `<docs>/assets/`. Copiar e colar dentro do próprio VS Code fica como está.
 */
export class PasteAsMarkdown implements vscode.DocumentPasteEditProvider {
  /** `get`: o fetch dos downloads (os testes simulam). */
  constructor(
    private readonly sites: LocalSites,
    private readonly get: typeof fetch = (...args) => fetch(...args),
  ) {}

  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    _ranges: readonly vscode.Range[],
    data: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    if (data.get('vscode-editor-data')) return undefined;
    const html = await data.get('text/html')?.asString();
    if (!html?.trim() || token.isCancellationRequested) return undefined;
    const markdown = await htmlToMarkdown(html, {
      pageHasTitle: /^# /m.test(document.getText()),
      importImage: document.uri.scheme === 'file' ? src => this.importImage(document.uri, src) : undefined,
    });
    if (token.isCancellationRequested || !markdown.trim()) return undefined;
    return [new vscode.DocumentPasteEdit(markdown, vscode.l10n.t('Paste as Markdown (TechDocs)'), PASTE_KIND)];
  }

  private async importImage(page: vscode.Uri, url: string): Promise<string | undefined> {
    const maxMB = vscode.workspace.getConfiguration('techdocsEditor', page).get<number>('images.maxSizeMB', DEFAULT_MAX_IMAGE_MB);
    try {
      const { name, mime, data } = await downloadImage(url, maxMB, this.get);
      const problem = imageProblem(mime, data.byteLength, maxMB);
      if (problem) throw new Error(problem === 'tooLarge' ? 'tooLarge' : vscode.l10n.t('"{0}" is not an image', name));
      const { path, link } = imageTarget(page.path, this.sites.siteOf(page)?.docsDir, name, Date.now());
      await vscode.workspace.fs.writeFile(page.with({ path }), data);
      return link;
    } catch (e) {
      const reason = e instanceof Error && e.message === 'tooLarge' ? vscode.l10n.t('larger than {0} MB', maxMB) : e instanceof Error ? e.message : String(e);
      void vscode.window.showWarningMessage(
        vscode.l10n.t('The pasted image could not be copied to the repository ({0}). It still points to {1}, which may not work on the site.', reason, new URL(url).host),
      );
      return undefined;
    }
  }
}
