import type { FileChange } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import { minimalEdit, toEol, toLf } from '../textSync';
import type { PageDoc, RepoGit } from './types';

/**
 * Roda o Git direto. Import dinâmico: o mesmo arquivo entra no pacote para navegador (vscode.dev), onde não há
 * `child_process` nem Git, e lá isto nunca é chamado (`gitApi()` é undefined).
 */
async function run(file: string, args: string[], options: { cwd?: string; buffer?: boolean } = {}): Promise<{ stdout: any }> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) =>
    execFile(file, args, { cwd: options.cwd, maxBuffer: 64 * 1024 * 1024, encoding: options.buffer ? 'buffer' : 'utf8' }, (error, stdout) =>
      error ? reject(error) : resolve({ stdout }),
    ),
  );
}

const fs = vscode.workspace.fs;
const readOrUndefined = (file: vscode.Uri) => fs.readFile(file).then(bytes => Buffer.from(bytes), () => undefined);
async function writeOrDelete(file: vscode.Uri, content: Buffer | undefined) {
  if (content === undefined) await fs.delete(file, { useTrash: false }).then(undefined, () => undefined);
  else await fs.writeFile(file, content);
}

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
  fetch(options?: { remote?: string }): Promise<void>;
  merge(ref: string): Promise<void>;
  addRemote(name: string, url: string): Promise<void>;
  getConfig(key: string): Promise<string>;
};
export type GitApi = {
  readonly git: { readonly path: string };
  readonly repositories: Repository[];
  openRepository(root: vscode.Uri): Promise<Repository | null>;
  init(root: vscode.Uri, options?: { defaultBranch?: string }): Promise<Repository | null>;
  clone(uri: vscode.Uri, options?: { parentPath?: vscode.Uri; postCloneAction?: 'none' }): Promise<vscode.Uri | null>;
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

/** O executável do Git que o VS Code usa (a configuração `git.path` ou o do sistema). */
async function gitPath() {
  return (await gitApi())?.git.path ?? 'git';
}

/**
 * O Git do clone pela API do `vscode.git` (LC5): passa pela autenticação e pelos hooks que o VS Code já usa. O que a
 * API não tem (diff com nomes, conteúdo de outra ref) vai pelo mesmo executável do Git, direto.
 */
export class VscodeGit implements RepoGit {
  private origin: string | undefined;

  constructor(readonly repository: Repository) {}

  private get rootUri() {
    return this.repository.rootUri;
  }

  get root() {
    return this.rootUri.fsPath;
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await run(await gitPath(), args, { cwd: this.root });
    return stdout;
  }

  private async gitBuffer(args: string[]): Promise<Buffer> {
    const { stdout } = await run(await gitPath(), args, { cwd: this.root, buffer: true });
    return stdout;
  }

  /** Conteúdo do arquivo em `ref`; undefined se não existe lá. */
  private async contentAt(ref: string, path: string): Promise<Buffer | undefined> {
    return this.gitBuffer(['show', `${ref}:${path}`]).catch(() => undefined);
  }

  private relative(uri: vscode.Uri) {
    return uri.path.slice(this.rootUri.path.replace(/\/$/, '').length + 1);
  }

  private absolute(path: string) {
    return vscode.Uri.joinPath(this.rootUri, path).fsPath;
  }

  async refresh() {
    await this.repository.status();
    this.origin = (await this.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).trim().replace(/^origin\//, '') || undefined;
  }

  defaultBranch() {
    return this.origin;
  }

  async fetch() {
    await this.repository.fetch({ remote: 'origin' });
    // O `origin/HEAD` de um clone antigo pode faltar: pergunta ao `origin` uma vez
    if (!this.origin) await this.git(['remote', 'set-head', 'origin', '--auto']).catch(() => undefined);
    await this.refresh();
  }

  async diffWith(ref: string): Promise<FileChange[]> {
    const tokens = (await this.git(['diff', '--name-status', '-z', '-M', ref])).split('\0').filter(Boolean);
    const changes: FileChange[] = [];
    for (let i = 0; i < tokens.length; ) {
      const status = tokens[i++];
      if (status.startsWith('R')) {
        const from = tokens[i++];
        changes.push({ path: tokens[i++], status: 'renamed', from });
      } else {
        const path = tokens[i++];
        changes.push({ path, status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified' });
      }
    }
    const untracked = (await this.git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
    // Removido + não versionado com o mesmo conteúdo = movido (o diff com a árvore não vê os não versionados)
    const deleted = new Map<string, FileChange>();
    for (const change of changes.filter(c => c.status === 'deleted')) {
      const blob = (await this.git(['rev-parse', `${ref}:${change.path}`]).catch(() => '')).trim();
      if (blob) deleted.set(blob, change);
    }
    for (const path of untracked) {
      const blob = deleted.size ? (await this.git(['hash-object', '--', path])).trim() : '';
      const moved = deleted.get(blob);
      if (moved) {
        deleted.delete(blob);
        changes.splice(changes.indexOf(moved), 1, { path, status: 'renamed', from: moved.path });
      } else changes.push({ path, status: 'added' });
    }
    return changes;
  }

  async merge(ref: string): Promise<string[]> {
    try {
      await this.repository.merge(ref);
      return [];
    } catch (error) {
      const conflicts = (await this.git(['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean);
      if (!conflicts.length) throw error;
      return conflicts;
    } finally {
      await this.refresh();
    }
  }

  async restoreFrom(ref: string, paths: string[]) {
    // O índice volta ao do HEAD nesses arquivos: nada fica preparado para um commit sem querer
    await this.git(['reset', '-q', '--', ...paths]).catch(() => undefined);
    for (const path of paths) await writeOrDelete(vscode.Uri.joinPath(this.rootUri, path), await this.contentAt(ref, path));
    await this.refresh();
  }

  async unstackOnto(branch: string, base: string): Promise<string[]> {
    const changes = await this.diffWith(base);
    const paths = changes.flatMap(c => (c.from ? [c.from, c.path] : [c.path]));
    // A `branch` mudou o arquivo desde a `base`: reaplicar por cima perderia uma das versões
    const conflicts: string[] = [];
    for (const path of paths) {
      const [atBranch, atBase] = await Promise.all([this.contentAt(branch, path), this.contentAt(base, path)]);
      if (!(atBranch === atBase || (atBranch && atBase && atBranch.equals(atBase)))) conflicts.push(path);
    }
    if (conflicts.length) return conflicts;
    const saved = new Map<string, Buffer | undefined>();
    for (const path of paths) saved.set(path, await readOrUndefined(vscode.Uri.joinPath(this.rootUri, path)));
    await this.git(['checkout', '-q', '-f', branch]);
    for (const [path, content] of saved) await writeOrDelete(vscode.Uri.joinPath(this.rootUri, path), content);
    await this.refresh();
    return [];
  }

  async addRemote(name: string, url: string) {
    await this.repository.addRemote(name, url);
    await this.refresh();
  }

  async identity() {
    const read = (key: string) => this.repository.getConfig(key).then(v => v.trim() || undefined, () => undefined);
    return { name: await read('user.name'), email: await read('user.email') };
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


/** Repositório novo no diretório (`git init` com a branch `main`). */
export async function initRepository(folder: vscode.Uri): Promise<RepoGit> {
  const api = await gitApi();
  const repository = api && (await api.init(folder, { defaultBranch: 'main' }));
  if (!repository) throw new Error(vscode.l10n.t('Git is not available in this VS Code.'));
  return new VscodeGit(repository);
}

/** Nome e e-mail do Git para todos os repositórios deste computador (tela 13). */
export async function setGlobalIdentity(name: string, email: string) {
  const git = await gitPath();
  await run(git, ['config', '--global', 'user.name', name]);
  await run(git, ['config', '--global', 'user.email', email]);
}

/** Clona em `<parent>/<nome do repositório>`, com o andamento do próprio Git do VS Code. */
export async function cloneRepository(url: string, parent: vscode.Uri): Promise<vscode.Uri | undefined> {
  const api = await gitApi();
  if (!api) throw new Error(vscode.l10n.t('Git is not available in this VS Code.'));
  return (await api.clone(vscode.Uri.parse(url), { parentPath: parent, postCloneAction: 'none' })) ?? undefined;
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
