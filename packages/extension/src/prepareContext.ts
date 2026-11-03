import * as vscode from 'vscode';
import { filesUnder } from './docsFiles';
import type { LocalSites } from './localSites';

/** O que o repositório já tem e a extensão pode usar para criar a documentação (o "Encontrei:" da tela). */
export type Found = { readme: boolean; docs: boolean; catalog: boolean };

/** Os mesmos arquivos do `workspaceContains` do package.json, na raiz de cada pasta do workspace. */
const README = /^readme\.md$/i;
const CATALOG = /^catalog-info\.ya?ml$/;

/** Repositório com algo do que se procura e sem site: a barra lateral mostra a tela de boas-vindas. */
export const canPrepare = (found: Found, hasSites: boolean) => !hasSites && (found.readme || found.docs || found.catalog);

/**
 * `techdocsEditor.canPrepare` (spec 00, BL6): o workspace não tem `mkdocs.yml`, mas tem README, uma pasta `docs/`
 * com páginas ou um `catalog-info.yaml`. Com ela, a seção Documentação mostra a tela "Preparar a documentação";
 * `techdocsEditor.found.*` dizem o que foi encontrado. Quando o site é criado, a árvore toma o lugar da tela.
 * Sem nada disso, depois da procura (`techdocsEditor.scanned`), a tela é a de "Criar a documentação" (BL7).
 */
export class PrepareContext implements vscode.Disposable {
  found: Found = { readme: false, docs: false, catalog: false };
  /** O valor de `techdocsEditor.canPrepare`. */
  active = false;
  /** Primeira leitura feita (os testes esperam por ela). */
  ready: Promise<void>;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly sites: LocalSites) {
    const later = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => (this.ready = this.update()), 300);
    };
    // Só a raiz de cada pasta do workspace e o docs/ dela: com o workspace no ~, um `**/*` avisava a cada arquivo
    // apagado em qualquer canto (caches, temporários) e cada aviso refazia a procura no ~ inteiro
    const watch = (folder: vscode.WorkspaceFolder) =>
      ['*', 'docs/**'].map(glob => {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, glob), false, true, false);
        this.disposables.push(watcher.onDidCreate(later), watcher.onDidDelete(later));
        return watcher;
      });
    let watchers = (vscode.workspace.workspaceFolders ?? []).flatMap(watch);
    this.disposables.push(
      sites.onDidChange(later),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        watchers.forEach(w => w.dispose());
        watchers = (vscode.workspace.workspaceFolders ?? []).flatMap(watch);
        later();
      }),
      { dispose: () => watchers.forEach(w => w.dispose()) },
    );
    this.ready = sites.ready.then(() => this.update());
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposables.forEach(d => d.dispose());
  }

  private async update() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    // Lido direto do disco, sem o findFiles: a busca do VS Code percorre o workspace inteiro mesmo para um arquivo
    // da raiz (no ~, minutos de ripgrep a cada mudança)
    const roots = await Promise.all(
      folders.map(folder => vscode.workspace.fs.readDirectory(folder.uri).then(list => list.map(([name]) => name), () => [] as string[])),
    );
    const atRoot = (name: RegExp) => roots.some(names => names.some(n => name.test(n)));
    const hasDocs = async () => {
      for (const folder of folders) if ((await filesUnder(vscode.Uri.joinPath(folder.uri, 'docs'), true)).length) return true;
      return false;
    };
    this.found = { readme: atRoot(README), docs: await hasDocs(), catalog: atRoot(CATALOG) };
    this.active = canPrepare(this.found, this.sites.all().length > 0);
    const set = (key: string, value: boolean) => vscode.commands.executeCommand('setContext', `techdocsEditor.${key}`, value);
    await Promise.all([
      set('canPrepare', this.active),
      set('found.readme', this.found.readme),
      set('found.docs', this.found.docs),
      set('found.catalog', this.found.catalog),
    ]);
    // Só depois da primeira procura a tela "Criar a documentação" pode aparecer (antes, a árvore ainda vai carregar)
    await set('scanned', true);
  }
}
