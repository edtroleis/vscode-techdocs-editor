import * as vscode from 'vscode';
import { DocsSite, siteFromMkdocs, siteOf } from './docsSite';

const MKDOCS = '**/mkdocs.{yml,yaml}';
const IGNORED = '**/{node_modules,.git,site,.venv}/**';

/**
 * Sites do MkDocs do workspace (modo local, spec 02 LC1): os `mkdocs.yml` achados, com o `docs_dir`
 * de cada um. Acompanha a criação, a mudança e a remoção dos arquivos.
 */
export class LocalSites implements vscode.Disposable {
  /** Por `mkdocs.yml`; `origin` separa sites de esquemas diferentes (disco, vscode-vfs…). */
  private sites = new Map<string, { origin: string; site: DocsSite }>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Os sites mudaram (um `mkdocs.yml` criado, alterado ou removido). */
  readonly onDidChange = this.changeEmitter.event;
  /** Primeira busca no workspace concluída. */
  readonly ready: Promise<void>;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(MKDOCS);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(uri => this.read(uri)),
      watcher.onDidChange(uri => this.read(uri)),
      watcher.onDidDelete(uri => {
        if (this.sites.delete(uri.toString())) this.changeEmitter.fire();
      }),
      this.changeEmitter,
    );
    this.ready = this.scan();
  }

  /** Site da página, ou undefined se ela não está no `docs_dir` de nenhum `mkdocs.yml`. */
  siteOf(uri: vscode.Uri): DocsSite | undefined {
    const sameOrigin = [...this.sites.values()].filter(s => s.origin === originOf(uri)).map(s => s.site);
    return siteOf(uri.path, sameOrigin);
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  private async scan() {
    const found = await vscode.workspace.findFiles(MKDOCS, IGNORED);
    await Promise.all(found.map(uri => this.read(uri, false)));
    this.changeEmitter.fire();
  }

  private async read(uri: vscode.Uri, notify = true) {
    let text = '';
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      // Lido entre a criação e a gravação, ou removido: o observador avisa de novo
      return;
    }
    this.sites.set(uri.toString(), { origin: originOf(uri), site: siteFromMkdocs(uri.path, text) });
    if (notify) this.changeEmitter.fire();
  }
}

const originOf = (uri: vscode.Uri) => `${uri.scheme}://${uri.authority}`;
