import {
  ChecksSummary,
  ChecksWatcher,
  failureHelp,
  GitHubClient,
  GitHubError,
  isDocsFile,
  itemCount,
  itemPaths,
  lintRuleText,
  parseAnnotation,
  Poller,
  PullRequest,
  Repo,
  sendGroups,
  SendGroup,
  SendItem,
  SendSite,
  summarize,
  VerificationMode,
} from '@edtroleis/techdocs-editor-core';
import type { RepoGit } from '../publish/types';

/**
 * O envio do repositório inteiro (spec 09): o que mudou na documentação vai num pedido de revisão só, acompanhado
 * até entrar na branch principal. Sem `vscode`: o Git é o `RepoGit` e o GitHub, o `GitHubClient`.
 */

export type SendTarget = 'pullRequest' | 'main';
export type CheckView = {
  name: string;
  state: 'running' | 'passed' | 'failed';
  url: string;
  help?: string;
  annotations: Array<{ path: string; line: number; text: string; snippet?: string }>;
};
export type SendState =
  | { status: 'idle'; groups: SendGroup[]; outside: string[]; count: number; primary: 'review' | 'publish' }
  | { status: 'sending'; step: 'saving' | 'updating' | 'uploading' | 'opening' }
  | {
      status: 'inReview';
      pr: { number: number; url: string };
      title: string;
      /** Mudanças da documentação feitas depois do último envio. */
      pending: number;
      checks: { summary: ChecksSummary; items: CheckView[]; stalled: boolean };
      review: 'waiting' | 'approved' | 'changesRequested';
      reviewer?: string;
      requiredApprovals: number;
    }
  | { status: 'merged'; by?: string }
  | { status: 'conflict'; paths: string[] }
  | { status: 'offline'; retrying: boolean }
  | { status: 'cannotWrite'; repoUrl: string }
  | { status: 'error'; message: string };

export type SendConfig = {
  language: string;
  checkHelp: Record<string, string>;
  startTimeoutMs: number;
  pollMs: number;
  idlePollMs: number;
  verificationMode: VerificationMode;
};

type L10n = { t(message: string, ...args: Array<string | number>): string };

export type SenderOptions = {
  git: RepoGit;
  client: GitHubClient;
  sites: () => SendSite[];
  target: SendTarget;
  branchPattern: string;
  /** Salva os documentos da documentação abertos e sujos (o editor visual inclusive). */
  saveAll: () => Promise<void>;
  pageText: (path: string) => string | undefined;
  l10n: L10n;
  confirm: (message: string, action: string) => Promise<boolean>;
  onChange: (state: SendState) => void;
  config: SendConfig;
  now?: () => Date;
  isOffline?: (error: unknown) => boolean;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** `docs/{login}/{date}` → `docs/msilva/20261124-1830` (horário local). */
export function envioBranch(pattern: string, login: string, now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return pattern.replace('{login}', login).replace('{date}', date);
}

const NETWORK = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|Could not resolve host|unable to access/i;
const defaultOffline = (error: unknown) =>
  !(error instanceof GitHubError) && NETWORK.test(String((error as { message?: string })?.message ?? error));
/** O push recusado pela proteção da branch principal. */
const PROTECTED = /GH006|protected branch|pre-receive hook declined/i;

export class Sender {
  private repo!: Repo;
  private login!: string;
  private requiredApprovals = 0;
  private pipeline = true;
  private pr: PullRequest | null = null;
  private title = '';
  private review: { state: 'waiting' | 'approved' | 'changesRequested'; by?: string } = { state: 'waiting' };
  private state: SendState = { status: 'idle', groups: [], outside: [], count: 0, primary: 'review' };
  /** Um envio (ou desistir) rodando: o polling não recalcula no meio. */
  private busy = false;
  /** O último envio caiu sem internet: tenta de novo ao voltar (tela 9). */
  private retry: { summary: string; target?: SendTarget } | undefined;
  private readonly watcher: ChecksWatcher;
  private readonly poller: Poller;

  constructor(private readonly options: SenderOptions) {
    this.watcher = new ChecksWatcher({
      client: options.client,
      startTimeoutMs: options.config.startTimeoutMs,
      onChange: () => this.state.status === 'inReview' && this.pr && this.emitReview(),
    });
    this.poller = new Poller({
      run: () => this.poll(),
      delayMs: () => (this.pr ? options.config.pollMs : options.config.idlePollMs),
    });
  }

  private get base() {
    return this.repo.defaultBranch;
  }

  get current(): SendState {
    return this.state;
  }

  /** Repositório, regras e o envio em andamento (a branch atual e o PR aberto dela, C2). */
  async load(): Promise<void> {
    const { client, git, config } = this.options;
    this.repo = await client.getRepo();
    const [login, rules, hasWorkflows] = await Promise.all([
      client.getLogin(),
      client.getBranchRules(this.repo.defaultBranch),
      client.hasWorkflows().catch(() => true),
    ]);
    this.login = login;
    this.requiredApprovals = rules.requiredApprovals;
    this.pipeline =
      config.verificationMode === 'pipeline' ||
      (config.verificationMode === 'auto' && (hasWorkflows || rules.requiredChecks.length > 0));
    await git.fetch().catch(() => undefined);
    const branch = git.currentBranch();
    this.pr = branch && branch !== this.base ? await client.findOpenPullRequest(branch) : null;
    if (this.pr) this.watcher.track(this.pr);
    await this.refresh();
    this.poller.setEnabled(true);
  }

  /** Recalcula o que vai (depois de salvar ou trocar de branch) e consulta o envio aberto. */
  async refresh(): Promise<void> {
    if (this.busy) return;
    if (this.retry && this.state.status === 'offline') {
      const { summary, target } = this.retry;
      return this.send(summary, { target });
    }
    const { git, client } = this.options;
    await git.refresh();
    if (this.pr) {
      const latest = await client.getPullRequest(this.pr.number).catch(() => this.pr!);
      if (latest.merged) return this.finishMerged();
      if (latest.state !== 'open') this.pr = null;
      else {
        this.pr = latest;
        this.review = await client.getReviewState(latest.number).catch(() => this.review);
        if (this.pipeline) await this.watcher.refresh().catch(() => undefined);
      }
    }
    if (this.pr) return this.emitReview(await this.pendingCount());
    if (this.state.status === 'merged' && !(await this.docsChanges()).length) return;
    await this.emitIdle();
  }

  /**
   * A consulta periódica: só o envio aberto (verificações, revisão, merge) e a nova tentativa sem internet. O resto
   * (conflito, erro, sem permissão) fica na tela até a pessoa agir.
   */
  private async poll() {
    if (this.busy) return;
    if (this.retry && this.state.status === 'offline') return this.refresh();
    if (this.pr) return this.refresh();
  }

  setFocused(focused: boolean) {
    this.poller.setFocused(focused);
  }

  dispose() {
    this.poller.dispose();
  }

  /** O envio (spec 09, "O envio"); também "Enviar de novo" e a nova tentativa depois de cair a rede. */
  async send(summary: string, opts: { target?: SendTarget } = {}): Promise<void> {
    const { git, client } = this.options;
    const target = opts.target ?? this.options.target;
    if (!this.repo.canWrite) return this.set({ status: 'cannotWrite', repoUrl: this.repo.htmlUrl });
    this.retry = undefined;
    this.busy = true;
    try {
      this.set({ status: 'sending', step: 'saving' });
      await this.options.saveAll();
      await git.refresh();
      this.set({ status: 'sending', step: 'updating' });
      await git.fetch();
      const remoteBase = `origin/${this.base}`;
      let branch = git.currentBranch()!;
      if (target === 'pullRequest' && branch === this.base) {
        branch = envioBranch(this.options.branchPattern, this.login, (this.options.now ?? (() => new Date()))());
        await git.createBranch(branch);
      }
      const paths = await this.docsPaths(remoteBase);
      const changed = git.changed(paths);
      if (changed.length) await git.commit(changed, summary);
      // A principal andou: traz antes (o que não se sobrepõe entra sozinho)
      const conflicts = await git.merge(remoteBase);
      if (conflicts.length) return this.set({ status: 'conflict', paths: conflicts });
      this.set({ status: 'sending', step: 'uploading' });
      try {
        await git.push(branch);
      } catch (error) {
        if (target === 'main' && PROTECTED.test(String((error as Error)?.message ?? error)))
          return this.set({ status: 'error', message: this.options.l10n.t('This repository requires review: send it for review instead.') });
        throw error;
      }
      if (target === 'main') {
        this.pr = null;
        return this.set({ status: 'merged' });
      }
      this.set({ status: 'sending', step: 'opening' });
      this.pr =
        (await client.findOpenPullRequest(branch)) ??
        (await client.createPullRequest({ branch, base: this.base, title: summary, body: '', draft: false }));
      this.title = summary;
      this.watcher.track(this.pr, git.headSha());
      this.emitReview(0);
      this.poller.setEnabled(true);
    } catch (error) {
      if ((this.options.isOffline ?? defaultOffline)(error)) {
        this.retry = { summary, target: opts.target };
        return this.set({ status: 'offline', retrying: true });
      }
      this.set({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.busy = false;
    }
  }

  /** Volta o item ao que está na principal, com confirmação. */
  async undo(item: SendItem): Promise<void> {
    const ok = await this.options.confirm(this.options.l10n.t('Undo this change? It goes back to what is on GitHub.'), this.options.l10n.t('Undo'));
    if (!ok) return;
    await this.options.git.restoreFrom(`origin/${this.base}`, itemPaths(item));
    await this.refresh();
  }

  /** Desistir do envio (C5): as mudanças voltam à principal local, não enviadas; nada se perde. */
  async giveUp(): Promise<void> {
    const { git, client } = this.options;
    const pr = this.pr;
    const branch = git.currentBranch();
    if (!pr || !branch || branch === this.base) return;
    const ok = await this.options.confirm(
      this.options.l10n.t('Give up this send? The review request is closed and your changes stay on this computer.'),
      this.options.l10n.t('Give up'),
    );
    if (!ok) return;
    const conflicts = await git.unstackOnto(this.base, `origin/${this.base}`);
    if (conflicts.length) return this.set({ status: 'conflict', paths: conflicts });
    await client.closePullRequest(pr.number);
    await client.deleteBranch(branch).catch(() => undefined);
    await git.deleteBranch(branch);
    this.pr = null;
    this.watcher.track(null);
    await this.refresh();
  }

  // ------------------------------------------------------------ por dentro

  private async finishMerged() {
    const { git } = this.options;
    const branch = git.currentBranch();
    const by = this.review.by;
    await git.fetch();
    await git.checkout(this.base);
    await git.merge(`origin/${this.base}`);
    if (branch && branch !== this.base) await git.deleteBranch(branch).catch(() => undefined);
    this.pr = null;
    this.watcher.track(null);
    this.review = { state: 'waiting' };
    this.set({ status: 'merged', by });
  }

  private async docsChanges(ref = `origin/${this.base}`) {
    const sites = this.options.sites();
    return (await this.options.git.diffWith(ref)).filter(c => isDocsFile(c.path, sites) || (c.from && isDocsFile(c.from, sites)));
  }

  private async docsPaths(ref: string) {
    return (await this.docsChanges(ref)).flatMap(c => (c.from ? [c.from, c.path] : [c.path]));
  }

  /** O que mudou desde o último envio (o que o `origin` da branch ainda não tem). */
  private async pendingCount() {
    const branch = this.options.git.currentBranch();
    const changes = await this.docsChanges(`origin/${branch}`).catch(() => []);
    return itemCount(sendGroups(changes, this.options.sites(), this.options.pageText).groups);
  }

  private async emitIdle() {
    const { git, sites, pageText } = this.options;
    const changes = await git.diffWith(`origin/${this.base}`);
    const { groups, outside } = sendGroups(changes, sites(), pageText);
    const publish = this.options.target === 'main' || this.requiredApprovals === 0;
    this.set({ status: 'idle', groups, outside, count: itemCount(groups), primary: publish ? 'publish' : 'review' });
  }

  private emitReview(pending = this.state.status === 'inReview' ? this.state.pending : 0) {
    const pr = this.pr!;
    const verification = this.watcher.current;
    const { config } = this.options;
    this.set({
      status: 'inReview',
      pr: { number: pr.number, url: pr.htmlUrl },
      title: this.title,
      pending,
      checks: {
        summary: summarize(verification.checks),
        stalled: this.pipeline && verification.stalled,
        items: verification.checks.map(run => ({
          name: run.name,
          state: run.status !== 'completed' ? 'running' : run.conclusion === 'success' || run.conclusion === 'neutral' ? 'passed' : 'failed',
          url: run.htmlUrl,
          help: failureHelp(run.name, config.checkHelp),
          annotations: (verification.annotations[run.id] ?? []).map(a => {
            const { rule, description } = parseAnnotation(a);
            return { path: a.path, line: a.line, text: rule ? lintRuleText(rule, config.language, description) : description, snippet: a.snippet };
          }),
        })),
      },
      review: this.review.state,
      reviewer: this.review.by,
      requiredApprovals: this.requiredApprovals,
    });
  }

  private set(state: SendState) {
    this.state = state;
    this.options.onChange(state);
  }
}
