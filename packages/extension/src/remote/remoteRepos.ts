import * as vscode from 'vscode';
import {
  findRemoteSites,
  GitHubClient,
  type GitHubTransport,
  GitHubError,
  loadRepoFiles,
  type RemoteSite,
  type Repo,
  type RepoTreeFile,
} from '@edtroleis/techdocs-editor-core';
import { anonymousClientFor, clientFor, hasSession, usingTestTransport, useTestTransport } from '../publish/githubAuth';

/** Um site aberto do GitHub (D4-1): só host, `dono/repo` e a pasta do `mkdocs.yml`; nunca token. */
export type RemoteEntry = { host: string; slug: string; root: string };

/** O repositório como a extensão o lê agora: cliente (com ou sem login), dados, arquivos da branch principal e sites. */
export type RepoAccess = {
  client: GitHubClient;
  /** Login do GitHub; undefined na leitura sem login (A-1). */
  login?: string;
  repo: Repo;
  files: RepoTreeFile[];
  sites: RemoteSite[];
};

/** Sem login, o GitHub não mostrou o repositório: é privado (ou não existe). */
export class SignInRequiredError extends Error {
  constructor(readonly host: string, readonly slug: string) {
    super(`Sign in to GitHub to open ${slug}`);
    this.name = 'SignInRequiredError';
  }
}

const STATE_KEY = 'techdocsEditor.remoteDocs';
const keyOf = (host: string, slug: string) => `${host}/${slug}`;
const sameEntry = (a: RemoteEntry, b: RemoteEntry) => a.host === b.host && a.slug === b.slug && a.root === b.root;

/**
 * Os sites abertos do GitHub (a lista fica no `globalState`, D4-1) e o acesso a cada repositório, guardado até
 * o login mudar ou alguém pedir para ler de novo.
 */
export class RemoteRepos implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<RepoAccess>>();
  /**
   * A lista em memória, gravada no `globalState` a cada mudança: lido logo depois de gravações seguidas, o
   * `globalState` às vezes devolvia uma versão anterior.
   */
  private entries: RemoteEntry[];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** A lista mudou ou o que se sabe dos repositórios foi descartado (ler de novo). */
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly state: vscode.Memento) {
    this.entries = state.get<RemoteEntry[]>(STATE_KEY, []);
    this.disposables.push(
      this.changeEmitter,
      vscode.authentication.onDidChangeSessions(({ provider }) => {
        if (provider.id === 'github' || provider.id === 'github-enterprise') this.refresh();
      }),
    );
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  list(): RemoteEntry[] {
    return [...this.entries];
  }

  async add(entry: RemoteEntry) {
    if (this.entries.some(other => sameEntry(other, entry))) return;
    await this.save([...this.entries, entry]);
  }

  async remove(entry: RemoteEntry) {
    await this.save(this.entries.filter(other => !sameEntry(other, entry)));
  }

  private async save(entries: RemoteEntry[]) {
    this.entries = entries;
    this.changeEmitter.fire();
    await this.state.update(STATE_KEY, entries);
  }

  /** Testes de integração: o GitHub simulado no lugar da API (com login), ou de volta ao GitHub de verdade. */
  useTestGitHub(transport: ((host: string) => GitHubTransport) | undefined) {
    useTestTransport(transport);
    this.refresh();
  }

  /** Lê de novo (todos os repositórios, ou um). */
  refresh(host?: string, slug?: string) {
    if (host && slug) this.cache.delete(keyOf(host, slug));
    else this.cache.clear();
    this.changeEmitter.fire();
  }

  /**
   * O repositório, com login se a pessoa já entrou no GitHub e sem login se não (A-1). `signIn`: pede o
   * login (repositório privado). Sem login e sem acesso: `SignInRequiredError`.
   */
  access(host: string, slug: string, { signIn = false } = {}): Promise<RepoAccess> {
    const key = keyOf(host, slug);
    const cached = this.cache.get(key);
    if (cached && !signIn) return cached;
    const loading = this.load(host, slug, signIn);
    this.cache.set(key, loading);
    loading.catch(() => {
      if (this.cache.get(key) === loading) this.cache.delete(key);
    });
    return loading;
  }

  private async load(host: string, slug: string, signIn: boolean): Promise<RepoAccess> {
    const signedIn = signIn || usingTestTransport() || (await hasSession(host));
    const client = signedIn ? clientFor(host, slug) : anonymousClientFor(host, slug);
    let repo: Repo;
    try {
      repo = await client.getRepo();
    } catch (error) {
      if (!signedIn && error instanceof GitHubError && [401, 403, 404].includes(error.status)) {
        throw new SignInRequiredError(host, slug);
      }
      throw error;
    }
    const [login, files, sites] = await Promise.all([
      signedIn ? client.getLogin() : undefined,
      loadRepoFiles(client, repo.defaultBranch),
      findRemoteSites(client, repo.defaultBranch),
    ]);
    // Sem login não se escreve (D4-7: o login só no primeiro salvar)
    return { client, login, repo: signedIn ? repo : { ...repo, canWrite: false, isAdmin: false }, files, sites };
  }
}
