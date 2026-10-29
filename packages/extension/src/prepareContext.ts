import * as vscode from 'vscode';
import type { LocalSites } from './localSites';

/** O que o repositório já tem e a extensão pode usar para criar a documentação (o "Encontrei:" da tela). */
export type Found = { readme: boolean; docs: boolean; catalog: boolean };

/** Os mesmos arquivos do `workspaceContains` do package.json, na raiz de cada pasta do workspace. */
const PATTERNS: Record<keyof Found, string> = {
  readme: '{README.md,readme.md,Readme.md}',
  docs: 'docs/**/*.md',
  catalog: 'catalog-info.{yaml,yml}',
};

/** Repositório com algo do que se procura e sem site: a barra lateral mostra a tela de boas-vindas. */
export const canPrepare = (found: Found, hasSites: boolean) => !hasSites && (found.readme || found.docs || found.catalog);

/**
 * `techdocsEditor.canPrepare` (spec 00, BL6): o workspace não tem `mkdocs.yml`, mas tem README, uma pasta `docs/`
 * com páginas ou um `catalog-info.yaml`. Com ela, o ícone TechDocs aparece com a tela "Preparar a documentação";
 * `techdocsEditor.found.*` dizem o que foi encontrado. Quando o site é criado, a árvore toma o lugar da tela.
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
    for (const pattern of Object.values(PATTERNS)) {
      const watcher = vscode.workspace.createFileSystemWatcher(`**/${pattern}`, false, true, false);
      this.disposables.push(watcher, watcher.onDidCreate(later), watcher.onDidDelete(later));
    }
    // Pasta apagada: o VS Code avisa só a pasta, não os `.md` de dentro
    const deletions = vscode.workspace.createFileSystemWatcher('**/*', true, true, false);
    this.disposables.push(deletions, deletions.onDidDelete(later), sites.onDidChange(later), vscode.workspace.onDidChangeWorkspaceFolders(later));
    this.ready = sites.ready.then(() => this.update());
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposables.forEach(d => d.dispose());
  }

  private async update() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    // Sem maxResults: no VS Code para navegador, findFiles com maxResults 1 não acha nada
    const has = async (pattern: string) => {
      for (const folder of folders) {
        if ((await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern), '**/node_modules/**')).length) return true;
      }
      return false;
    };
    this.found = { readme: await has(PATTERNS.readme), docs: await has(PATTERNS.docs), catalog: await has(PATTERNS.catalog) };
    this.active = canPrepare(this.found, this.sites.list().length > 0);
    const set = (key: string, value: boolean) => vscode.commands.executeCommand('setContext', `techdocsEditor.${key}`, value);
    await Promise.all([
      set('canPrepare', this.active),
      set('found.readme', this.found.readme),
      set('found.docs', this.found.docs),
      set('found.catalog', this.found.catalog),
    ]);
  }
}
