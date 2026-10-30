import * as vscode from 'vscode';
import { minimalEdit, toEol, toLf } from '../textSync';
import type { LocalGit, PageDoc } from './types';

// O pedaço da API da extensão Git do VS Code (`vscode.git`, versão 1) que o painel usa.
// Tipos completos: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
type Change = { readonly uri: vscode.Uri; readonly status?: number };
type Branch = { readonly name?: string; readonly commit?: string; readonly type?: number };
type Repository = {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD: Branch | undefined;
    readonly remotes: Array<{ readonly name: string; readonly fetchUrl?: string; readonly pushUrl?: string }>;
    readonly indexChanges: Change[];
    readonly workingTreeChanges: Change[];
    readonly untrackedChanges?: Change[];
    readonly onDidChange: vscode.Event<void>;
  };
  getRefs(query: { pattern?: string }): Promise<Branch[]>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;
  checkout(treeish: string): Promise<void>;
  add(paths: string[]): Promise<void>;
  commit(message: string, opts?: { empty?: boolean }): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
  clean(paths: string[]): Promise<void>;
  log(options?: { maxEntries?: number }): Promise<Array<{ hash: string; message: string }>>;
  status(): Promise<void>;
};
export type GitApi = {
  readonly repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
  readonly onDidOpenRepository: vscode.Event<Repository>;
};

/** API da extensão Git do VS Code; undefined se ela estiver desligada ou não existir (VS Code para a Web). */
export async function gitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<{ enabled: boolean; getAPI(version: 1): GitApi }>('vscode.git');
  if (!extension) return undefined;
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.enabled ? exports.getAPI(1) : undefined;
}

const LOCAL_BRANCH = 0;
/** `Status` da API do Git: arquivo novo no índice e arquivo fora do Git. */
const INDEX_ADDED = 1;
const UNTRACKED = 7;

/** O Git do clone pela API do `vscode.git` (LC5): passa pela autenticação e pelos hooks que o VS Code já usa. */
export class VscodeGit implements LocalGit {
  constructor(readonly repository: Repository) {}

  private get root() {
    return this.repository.rootUri;
  }

  private relative(uri: vscode.Uri) {
    return uri.path.slice(this.root.path.replace(/\/$/, '').length + 1);
  }

  private absolute(path: string) {
    return vscode.Uri.joinPath(this.root, path).fsPath;
  }

  async refresh() {
    await this.repository.status();
  }

  remoteUrl() {
    const remotes = this.repository.state.remotes;
    const remote = remotes.find(r => r.name === 'origin') ?? remotes[0];
    return remote?.pushUrl ?? remote?.fetchUrl;
  }

  currentBranch() {
    return this.repository.state.HEAD?.name;
  }

  headSha() {
    return this.repository.state.HEAD?.commit;
  }

  async headMessage() {
    return (await this.repository.log({ maxEntries: 1 }))[0]?.message ?? '';
  }

  async hasLocalBranch(name: string) {
    const refs = await this.repository.getRefs({ pattern: `refs/heads/${name}` });
    return refs.some(ref => ref.type === LOCAL_BRANCH && ref.name === name);
  }

  changed(paths: string[]) {
    const { indexChanges, workingTreeChanges, untrackedChanges = [] } = this.repository.state;
    const changed = new Set([...indexChanges, ...workingTreeChanges, ...untrackedChanges].map(c => this.relative(c.uri)));
    return paths.filter(p => changed.has(p));
  }

  changedFiles() {
    const { indexChanges, workingTreeChanges, untrackedChanges = [] } = this.repository.state;
    return [...new Set([...indexChanges, ...workingTreeChanges, ...untrackedChanges].map(c => this.relative(c.uri)))];
  }

  tracked(path: string) {
    const { indexChanges, workingTreeChanges, untrackedChanges = [] } = this.repository.state;
    const isNew = (c: Change) => c.status === INDEX_ADDED || c.status === UNTRACKED;
    return ![...indexChanges.filter(isNew), ...workingTreeChanges.filter(isNew), ...untrackedChanges].some(c => this.relative(c.uri) === path);
  }

  stagedOutside(paths: string[]) {
    return this.repository.state.indexChanges.map(c => this.relative(c.uri)).filter(p => !paths.includes(p));
  }

  async createBranch(name: string, from?: string) {
    await this.repository.createBranch(name, true, from);
  }

  async checkout(name: string) {
    await this.repository.checkout(name);
  }

  async deleteBranch(name: string) {
    await this.repository.deleteBranch(name, true);
  }

  async commit(paths: string[], message: string) {
    await this.repository.add(paths.map(p => this.absolute(p)));
    await this.repository.commit(message);
  }

  async commitEmpty(message: string) {
    await this.repository.commit(message, { empty: true });
  }

  async push(branch: string) {
    const remote = this.repository.state.remotes.find(r => r.name === 'origin') ?? this.repository.state.remotes[0];
    await this.repository.push(remote?.name, branch, true);
  }

  async discardChanges(paths: string[]) {
    const changed = this.changed(paths);
    if (changed.length) await this.repository.clean(changed.map(p => this.absolute(p)));
  }
}

/** A página aberta (o `TextDocument`, a fonte da verdade do editor visual). */
export class DocumentPage implements PageDoc {
  constructor(
    private readonly document: vscode.TextDocument,
    readonly path: string,
    readonly docsDir: string,
    readonly mkdocs?: string,
  ) {}

  text() {
    return toLf(this.document.getText());
  }

  get dirty() {
    return this.document.isDirty;
  }

  async save() {
    if (this.document.isDirty && !(await this.document.save())) throw new Error(vscode.l10n.t('Could not save the page.'));
  }

  async replaceText(text: string) {
    const file = this.document.getText();
    const eol = this.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const { start, end, text: inserted } = minimalEdit(file, toEol(text, eol));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, new vscode.Range(this.document.positionAt(start), this.document.positionAt(end)), inserted);
    await vscode.workspace.applyEdit(edit);
  }

  async revert() {
    if (!this.document.isDirty) return;
    // Sem API para reverter um documento: o comando age no editor ativo, então mostra a página antes
    await vscode.window.showTextDocument(this.document, { preview: false });
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }
}
