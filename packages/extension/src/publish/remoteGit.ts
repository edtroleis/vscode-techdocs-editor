import { GitHubClient, RemoteSession, SKIP_CI } from '@edtroleis/techdocs-editor-core';
import type { LocalGit } from './types';

type Options = {
  client: GitHubClient;
  defaultBranch: string;
  /** Branch do rascunho da página (D4-3). */
  draftBranch: string;
  remoteUrl: string;
  /** A sessão da página agora (o Ctrl+S a atualiza: branch criada, SHA novo). */
  session: () => RemoteSession;
  /** Lê a página de novo do GitHub (depois de descartar o rascunho). */
  reload: () => Promise<void>;
};

/**
 * O "Git" do painel Publicação no modo remoto (fase 4d, D4-5): o `LocalPublisher` inteiro, com a API do GitHub
 * no lugar do clone. Não há árvore de trabalho: o Ctrl+S já faz o commit do rascunho (com `[skip ci]`, 4c), e
 * a página "tem alteração" enquanto esse commit não passou pelo painel. "Salvar e verificar" vira então um
 * commit vazio sem `[skip ci]`, que dispara a pipeline. Sem `vscode`.
 */
export class RemoteGit implements LocalGit {
  /** A pessoa "trocou" para a branch do rascunho, que só é criada no GitHub no primeiro commit ou push. */
  private switched = false;
  /** Criada aqui (a sessão da página só fica sabendo no próximo Ctrl+S). */
  private created = false;
  /** SHA da página no último commit que o painel registrou. */
  private committed: string;
  private sha: string | undefined;

  constructor(private readonly options: Options) {
    this.committed = options.session().contentSha;
  }

  private get exists() {
    return this.created || this.options.session().hasBranch;
  }

  async refresh() {
    this.sha = (await this.options.client.getBranchSha(this.currentBranch())) ?? undefined;
  }

  remoteUrl() {
    return this.options.remoteUrl;
  }

  currentBranch() {
    return this.exists || this.switched ? this.options.draftBranch : this.options.defaultBranch;
  }

  headSha() {
    return this.sha;
  }

  async headMessage() {
    return this.exists ? this.options.client.getHeadMessage(this.currentBranch()) : '';
  }

  async hasLocalBranch(name: string) {
    return name === this.options.draftBranch && this.exists;
  }

  changed(paths: string[]) {
    const session = this.options.session();
    return paths.includes(session.filePath) && session.contentSha !== this.committed ? [session.filePath] : [];
  }

  changedFiles() {
    return [];
  }

  tracked() {
    return true;
  }

  stagedOutside() {
    return [];
  }

  async createBranch() {
    this.switched = true;
  }

  async checkout(name: string) {
    this.switched = name === this.options.draftBranch;
  }

  /** A branch do GitHub já foi apagada pelo `LocalPublisher`; aqui não há cópia local. */
  async deleteBranch() {}

  /** O commit do texto já existe (Ctrl+S); sem `[skip ci]` na mensagem, um commit vazio dispara a pipeline. */
  async commit(_paths: string[], message: string) {
    this.committed = this.options.session().contentSha;
    if (!message.includes(SKIP_CI)) await this.commitEmpty(message);
  }

  async commitEmpty(message: string) {
    await this.ensureRemoteBranch();
    this.sha = await this.options.client.createEmptyCommit(this.currentBranch(), message);
  }

  async push() {
    await this.ensureRemoteBranch();
    await this.refresh();
  }

  async discardChanges() {
    this.switched = false;
    this.created = false;
    await this.options.reload();
    this.committed = this.options.session().contentSha;
  }

  /** Branch trocada antes de qualquer commit: criada agora, do commit da principal em que a página foi lida. */
  private async ensureRemoteBranch() {
    const session = this.options.session();
    if (this.exists) return;
    if (await this.options.client.getBranchSha(this.options.draftBranch)) {
      this.created = true;
      return;
    }
    await this.options.client.createBranch(this.options.draftBranch, session.mainSha);
    this.created = true;
  }
}
