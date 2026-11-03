import * as vscode from 'vscode';
import { moveLinks, movePagesInNav, pagesLinkingTo, readNav, writeNav } from '@edtroleis/techdocs-editor-core';
import type { DocsSite } from './docsSite';
import { filesUnder } from './docsFiles';
import type { LocalSites } from './localSites';
import { removePages } from './treeActions';

type Site = { mkdocs: vscode.Uri; site: DocsSite };

/** O que a última operação do Explorer acertou, para o aviso depois dela. */
type Summary = { name: string; nav: boolean; links: number; renames: { oldUri: vscode.Uri; newUri: vscode.Uri }[] };

/**
 * O Explorer do VS Code (e quem renomeia ou exclui pela API, como o Desfazer) mexe nos arquivos do `docs_dir`: o
 * menu do site (`nav` do `mkdocs.yml`) e os links das páginas acompanham. As mudanças entram na mesma operação
 * (`waitUntil`), então o Ctrl+Z do Explorer as desfaz junto. O terminal (`mv`, `rm`) não avisa ninguém: lá não há
 * como acompanhar.
 */
export class ExplorerSync implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[];
  private pending: Summary | undefined;
  /** Os arquivos acertados na operação em curso (salvos quando ela termina: senão ficam abertos sem salvar). */
  private edited: vscode.Uri[] = [];
  /** O Desfazer do aviso renomeia de volta: esse não precisa de aviso. */
  private quiet = false;
  /** O Desfazer já acertou o menu e os links: o renomear dele vai sem nada junto (senão o VS Code pergunta de novo). */
  private skip = false;

  constructor(private readonly sites: LocalSites) {
    this.disposables = [
      vscode.workspace.onWillRenameFiles(e => {
        if (enabled() && !this.skip) e.waitUntil(this.renameEdit(e.files));
      }),
      vscode.workspace.onDidRenameFiles(() => this.done()),
      vscode.workspace.onWillDeleteFiles(e => {
        if (enabled()) e.waitUntil(this.deleteEdit(e.files));
      }),
      vscode.workspace.onDidDeleteFiles(() => this.done()),
    ];
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  /** O site cujo `docs_dir` tem o arquivo (o mais fundo, se um site está dentro do outro). */
  private siteOf(uri: vscode.Uri): Site | undefined {
    return this.sites
      .all()
      .filter(({ mkdocs, site }) => mkdocs.scheme === uri.scheme && (uri.path === site.docsDir || uri.path.startsWith(`${site.docsDir}/`)))
      .sort((a, b) => b.site.docsDir.length - a.site.docsDir.length)[0];
  }

  private async renameEdit(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<vscode.WorkspaceEdit> {
    const edit = new vscode.WorkspaceEdit();
    const bySite = new Map<string, { site: Site; moved: Map<string, string>; gone: Set<string> }>();
    for (const { oldUri, newUri } of files) {
      const site = this.siteOf(oldUri);
      if (!site || oldUri.path === site.site.docsDir) continue;
      const entry = bySite.get(site.mkdocs.toString()) ?? { site, moved: new Map(), gone: new Set() };
      bySite.set(site.mkdocs.toString(), entry);
      const docs = site.site.docsDir;
      const inside = (await isDirectory(oldUri)) ? (await filesUnder(oldUri)).map(uri => uri.path) : [oldUri.path];
      // Para fora do docs_dir (ou para outro site): sai do menu, como se tivesse sido excluído
      const stays = this.siteOf(newUri)?.mkdocs.toString() === site.mkdocs.toString();
      for (const path of inside) {
        const from = path.slice(docs.length + 1);
        if (stays) entry.moved.set(from, newUri.path.slice(docs.length + 1) + path.slice(oldUri.path.length));
        else entry.gone.add(from);
      }
    }
    let nav = false;
    let links = 0;
    for (const { site, moved, gone } of bySite.values()) {
      const docsDir = site.mkdocs.with({ path: site.site.docsDir });
      if (moved.size) {
        for (const page of await pagesOf(docsDir)) {
          const text = moveLinks(page.text, page.path, moved.get(page.path) ?? page.path, moved);
          if (text !== page.text) {
            const after = moved.get(page.path);
            if (await replaceAll(edit, page.uri, text)) this.edited.push(after ? vscode.Uri.joinPath(docsDir, after) : page.uri);
            links++;
          }
        }
      }
      const yml = await textOf(site.mkdocs);
      const menu = yml === undefined ? undefined : readNav(yml);
      if (menu && yml !== undefined) {
        const changed = (moved.size > 0 && movePagesInNav(menu, moved)) || (gone.size > 0 && removePages(menu, gone));
        if (changed) {
          if (await replaceAll(edit, site.mkdocs, writeNav(yml, menu))) this.edited.push(site.mkdocs);
          nav = true;
        }
      }
    }
    if ((nav || links) && !this.quiet) {
      this.pending = { name: files.length === 1 ? baseName(files[0].oldUri) : vscode.l10n.t('{0} items', files.length), nav, links, renames: [...files] };
    }
    return edit;
  }

  private async deleteEdit(files: readonly vscode.Uri[]): Promise<vscode.WorkspaceEdit> {
    const edit = new vscode.WorkspaceEdit();
    let nav = false;
    let links = 0;
    const bySite = new Map<string, { site: Site; gone: Set<string> }>();
    for (const uri of files) {
      const site = this.siteOf(uri);
      if (!site || uri.path === site.site.docsDir) continue;
      const entry = bySite.get(site.mkdocs.toString()) ?? { site, gone: new Set() };
      bySite.set(site.mkdocs.toString(), entry);
      const inside = (await isDirectory(uri)) ? await filesUnder(uri, true) : [uri];
      for (const file of inside) entry.gone.add(file.path.slice(site.site.docsDir.length + 1));
    }
    for (const { site, gone } of bySite.values()) {
      const yml = await textOf(site.mkdocs);
      const menu = yml === undefined ? undefined : readNav(yml);
      if (menu && yml !== undefined && removePages(menu, gone)) {
        if (await replaceAll(edit, site.mkdocs, writeNav(yml, menu))) this.edited.push(site.mkdocs);
        nav = true;
      }
      // As páginas que ficam e apontam para uma das excluídas: o link quebra (o aviso conta)
      const others = (await pagesOf(site.mkdocs.with({ path: site.site.docsDir }))).filter(p => !gone.has(p.path));
      links += new Set([...gone].flatMap(path => pagesLinkingTo(path, others))).size;
    }
    if (nav || links) this.pending = { name: files.length === 1 ? baseName(files[0]) : vscode.l10n.t('{0} items', files.length), nav, links: -links, renames: [] };
    return edit;
  }

  /** A operação terminou: salva o que a extensão acertou (o que já estava sem salvar fica como estava) e avisa. */
  private async done() {
    const edited = this.edited;
    this.edited = [];
    const keys = new Set(edited.map(uri => uri.toString()));
    await Promise.all(vscode.workspace.textDocuments.filter(d => keys.has(d.uri.toString()) && d.isDirty).map(d => d.save()));
    this.report();
  }

  /** O aviso do que mudou junto (o Desfazer dele renomeia de volta, e o menu e os links voltam do mesmo jeito). */
  private report() {
    const summary = this.pending;
    this.pending = undefined;
    if (!summary) return;
    const parts = [summary.nav ? vscode.l10n.t('the menu of the site') : undefined, summary.links > 0 ? (summary.links === 1 ? vscode.l10n.t('the links of 1 page') : vscode.l10n.t('the links of {0} pages', summary.links)) : undefined].filter(
      (part): part is string => Boolean(part),
    );
    const what = parts.length === 2 ? vscode.l10n.t('{0} and {1}', parts[0], parts[1]) : parts[0];
    if (!summary.renames.length) {
      const removed = summary.nav ? vscode.l10n.t('"{0}" deleted and taken out of the menu of the site.', summary.name) : vscode.l10n.t('"{0}" deleted.', summary.name);
      const broken = -summary.links;
      const tail = broken ? ` ${broken === 1 ? vscode.l10n.t('1 page now has a broken link.') : vscode.l10n.t('{0} pages now have a broken link.', broken)}` : '';
      return void vscode.window.showInformationMessage(removed + tail);
    }
    const message = vscode.l10n.t('"{0}" moved. Also updated: {1}.', summary.name, what);
    const undo = vscode.l10n.t('Undo');
    void vscode.window.showInformationMessage(message, undo).then(async choice => {
      if (choice === undo) await this.undo(summary.renames);
    });
  }

  /**
   * Volta o que o Explorer moveu: primeiro o menu e os links (edição de texto, sem pergunta), depois os arquivos sem
   * nada junto. Mover com edições junto faz o VS Code pedir confirmação de novo ("wants to make refactoring changes").
   */
  private async undo(renames: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]) {
    const back = [...renames].reverse().map(({ oldUri, newUri }) => ({ oldUri: newUri, newUri: oldUri }));
    this.quiet = true;
    try {
      const texts = await this.renameEdit(back);
      this.edited = [];
      if (texts.size) {
        await vscode.workspace.applyEdit(texts);
        const keys = new Set(texts.entries().map(([uri]) => uri.toString()));
        await Promise.all(vscode.workspace.textDocuments.filter(d => keys.has(d.uri.toString()) && d.isDirty).map(d => d.save()));
      }
      const files = new vscode.WorkspaceEdit();
      for (const { oldUri, newUri } of back) files.renameFile(oldUri, newUri);
      this.skip = true;
      try {
        await vscode.workspace.applyEdit(files);
      } finally {
        this.skip = false;
      }
    } finally {
      this.quiet = false;
      this.pending = undefined;
    }
  }
}

/** `techdocsEditor.syncExplorer`: o menu e os links acompanham o Explorer. */
function enabled(): boolean {
  return vscode.workspace.getConfiguration('techdocsEditor').get<boolean>('syncExplorer', true);
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

/** O texto do arquivo, o do editor se ele está aberto (com o que ainda não foi salvo). */
async function textOf(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function pagesOf(docsDir: vscode.Uri) {
  const files = await filesUnder(docsDir, true);
  return Promise.all(files.map(async uri => ({ uri, path: uri.path.slice(docsDir.path.length + 1), text: (await textOf(uri)) ?? '' })));
}

/** Troca o texto todo do arquivo (aberto pelo VS Code para a edição, se ainda não estava). */
async function replaceAll(edit: vscode.WorkspaceEdit, uri: vscode.Uri, text: string) {
  const document = await vscode.workspace.openTextDocument(uri);
  edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end), text);
  return !document.isDirty;
}

function baseName(uri: vscode.Uri): string {
  return uri.path.replace(/\/+$/, '').split('/').pop() ?? uri.path;
}
