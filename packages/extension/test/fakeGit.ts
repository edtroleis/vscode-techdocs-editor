import type { FileChange } from '@edtroleis/techdocs-editor-core';
import type { FakeCommit, FakeGitHub } from '../../core/test/fakeGitHub';
import type { RepoGit } from '../src/publish/types';

/**
 * Clone local simulado: árvore de trabalho (`work`, arquivo ausente = apagado), índice e branches; o push chega ao
 * GitHub simulado, e `origin/<branch>` é o que o último fetch ou push viu dele.
 */
export class FakeGit implements RepoGit {
  readonly root = '/clone';
  readonly branches = new Map<string, FakeCommit>();
  /** As branches do `origin` no último fetch/push. */
  readonly remote = new Map<string, FakeCommit>();
  current = 'main';
  work: Record<string, string>;
  readonly staged = new Set<string>();
  hasOrigin = true;
  user: { name?: string; email?: string } = { name: 'Pessoa Teste', email: 'pessoa@example.com' };
  /** Recusa o push desta branch (proteção da branch no GitHub). */
  rejectPush?: (branch: string) => Error | undefined;
  readonly pushes: string[] = [];

  constructor(private readonly github: FakeGitHub) {
    const main = github.head('main')!;
    this.branches.set('main', main);
    this.remote.set('main', main);
    this.work = { ...main.files };
  }

  private get head() {
    return this.branches.get(this.current)!;
  }

  /** Os arquivos de uma ref (`origin/main`, `main`, um SHA). */
  files(ref: string): Record<string, string> {
    const commit = ref.startsWith('origin/') ? this.remote.get(ref.slice(7)) : (this.branches.get(ref) ?? this.github.commits.get(ref));
    if (!commit) throw new Error(`ref desconhecida: ${ref}`);
    return commit.files;
  }

  private commitOf(ref: string) {
    return ref.startsWith('origin/') ? this.remote.get(ref.slice(7))! : this.branches.get(ref)!;
  }

  private ancestors(sha: string): string[] {
    const seen: string[] = [];
    const queue = [sha];
    while (queue.length) {
      const next = queue.shift()!;
      if (seen.includes(next)) continue;
      seen.push(next);
      queue.push(...(this.github.commits.get(next)?.parents ?? []));
    }
    return seen;
  }

  refresh = async () => {};
  remoteUrl = () => (this.hasOrigin ? `https://github.com/${this.github.slug}.git` : undefined);
  currentBranch = () => this.current;
  headSha = () => this.head.sha;
  headMessage = async () => this.head.message;
  hasLocalBranch = async (name: string) => this.branches.has(name);
  changed = (paths: string[]) => paths.filter(p => this.work[p] !== this.head.files[p]);
  changedFiles = () => [...new Set([...Object.keys(this.work), ...Object.keys(this.head.files)])].filter(p => this.work[p] !== this.head.files[p]);
  tracked = (path: string) => this.head.files[path] !== undefined;
  stagedOutside = (paths: string[]) => [...this.staged].filter(p => !paths.includes(p));
  defaultBranch = () => (this.hasOrigin ? 'main' : undefined);
  identity = async () => this.user;

  async createBranch(name: string, from?: string) {
    this.branches.set(name, from ? this.commitOf(from) : this.head);
    this.current = name;
  }

  async checkout(name: string) {
    const before = this.head.files;
    const work = { ...this.commitOf(name).files };
    // Como o git: as alterações não commitadas vão junto
    for (const path of new Set([...Object.keys(this.work), ...Object.keys(before)])) {
      if (this.work[path] === before[path]) continue;
      if (this.work[path] === undefined) delete work[path];
      else work[path] = this.work[path];
    }
    this.work = work;
    this.current = name;
  }

  async deleteBranch(name: string) {
    this.branches.delete(name);
  }

  async commit(paths: string[], message: string) {
    const files = { ...this.head.files };
    for (const p of paths) {
      if (this.work[p] === undefined) delete files[p];
      else files[p] = this.work[p];
    }
    this.branches.set(this.current, this.github.commit(message, files, [this.head.sha]));
  }

  async commitEmpty(message: string) {
    this.branches.set(this.current, this.github.commit(message, this.head.files, [this.head.sha]));
  }

  async push(branch: string) {
    const error = this.rejectPush?.(branch);
    if (error) throw error;
    const commit = this.branches.get(branch)!;
    this.github.push(branch, commit);
    this.remote.set(branch, commit);
    this.pushes.push(branch);
  }

  async discardChanges(paths: string[]) {
    for (const p of paths) {
      if (this.head.files[p] === undefined) delete this.work[p];
      else this.work[p] = this.head.files[p];
    }
  }

  async fetch() {
    for (const branch of this.github.refs.keys()) this.remote.set(branch, this.github.head(branch)!);
    for (const branch of [...this.remote.keys()]) if (!this.github.refs.has(branch)) this.remote.delete(branch);
  }

  async diffWith(ref: string): Promise<FileChange[]> {
    const base = this.files(ref);
    const changes: FileChange[] = [];
    for (const path of new Set([...Object.keys(base), ...Object.keys(this.work)])) {
      if (base[path] === this.work[path]) continue;
      changes.push({ path, status: base[path] === undefined ? 'added' : this.work[path] === undefined ? 'deleted' : 'modified' });
    }
    // Removido + novo com o mesmo conteúdo = movido
    for (const deleted of changes.filter(c => c.status === 'deleted')) {
      const added = changes.find(c => c.status === 'added' && this.work[c.path] === base[deleted.path]);
      if (!added) continue;
      changes.splice(changes.indexOf(deleted), 1);
      Object.assign(added, { status: 'renamed', from: deleted.path });
    }
    return changes;
  }

  async merge(ref: string): Promise<string[]> {
    const theirs = this.commitOf(ref);
    const ofHead = this.ancestors(this.head.sha);
    if (ofHead.includes(theirs.sha)) return [];
    const baseSha = this.ancestors(theirs.sha).find(sha => ofHead.includes(sha));
    const base = baseSha ? this.github.commits.get(baseSha)!.files : {};
    const ours = this.head.files;
    const result: Record<string, string> = {};
    const conflicts: string[] = [];
    for (const path of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs.files)])) {
      const [b, o, t] = [base[path], ours[path], theirs.files[path]];
      const merged = o === t ? o : o === b ? t : t === b ? o : null;
      if (merged === null) conflicts.push(path);
      else if (merged !== undefined) result[path] = merged;
    }
    if (conflicts.length) return conflicts;
    for (const path of new Set([...Object.keys(result), ...Object.keys(ours)])) {
      if (this.work[path] !== ours[path]) continue; // alteração não commitada fica
      if (result[path] === undefined) delete this.work[path];
      else this.work[path] = result[path];
    }
    this.branches.set(this.current, this.github.commit(`Merge ${ref}`, result, [this.head.sha, theirs.sha]));
    return [];
  }

  async restoreFrom(ref: string, paths: string[]) {
    const files = this.files(ref);
    for (const path of paths) {
      if (files[path] === undefined) delete this.work[path];
      else this.work[path] = files[path];
    }
  }

  async unstackOnto(branch: string, base: string): Promise<string[]> {
    const changes = await this.diffWith(base);
    const paths = changes.flatMap(c => (c.from ? [c.from, c.path] : [c.path]));
    const [atBranch, atBase] = [this.files(branch), this.files(base)];
    const conflicts = paths.filter(path => atBranch[path] !== atBase[path]);
    if (conflicts.length) return conflicts;
    const saved = Object.fromEntries(paths.map(path => [path, this.work[path]]));
    this.current = branch;
    this.work = { ...atBranch };
    for (const [path, content] of Object.entries(saved)) {
      if (content === undefined) delete this.work[path];
      else this.work[path] = content;
    }
    return [];
  }

  async addRemote() {
    this.hasOrigin = true;
  }
}
