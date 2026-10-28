import {
  branchFor,
  ChecksSummary,
  ChecksWatcher,
  dirOf,
  failureHelp,
  fixLintProblems,
  GitHubClient,
  lintFindings,
  lintRuleText,
  pageTitle,
  nameToTitle,
  parseAnnotation,
  Poller,
  PullRequest,
  Repo,
  resolvePath,
  SKIP_CI,
  summarize,
  VerificationMode,
} from '@edtroleis/techdocs-editor-core';
import type { Configuration } from 'markdownlint';
import type { LocalGit, PageDoc } from './types';

export type PublishConfig = {
  branchPattern: string;
  /** "Salvar rascunho" leva `[skip ci]` (onde há pipeline). */
  skipCi: boolean;
  verificationMode: VerificationMode;
  startTimeoutMs: number;
  pollMs: number;
  idlePollMs: number;
  /** Mensagem em linguagem simples por nome de check (`verification.checkHelp`). */
  checkHelp: Record<string, string>;
  /** Idioma dos textos das regras do lint (`vscode.env.language`). */
  language: string;
};

type L10n = { t(message: string, ...args: Array<string | number>): string };

export type CheckView = {
  name: string;
  state: 'running' | 'passed' | 'failed';
  url: string;
  help?: string;
  annotations: Array<{ path: string; line: number; text: string; snippet?: string }>;
};

/** Tudo o que o webview do painel desenha (sem token nem cliente: A-6). */
export type PublishView = {
  page: string;
  branch: string;
  /** A pessoa está na branch principal: salvar cria a branch do rascunho. */
  onDefaultBranch: boolean;
  defaultBranch: string;
  pr?: { number: number; url: string; draft: boolean };
  /** O texto foi salvo depois da última verificação ("Salvar rascunho" pula a pipeline). */
  unverified: boolean;
  busy: boolean;
  notice?: string;
  error?: string;
  /** "Enviar para publicação" (0 aprovações no ruleset) ou "Enviar para revisão". */
  sendForReview: boolean;
  /** Descartar apaga a branch (só a criada pelo painel, D3-4). */
  ownBranch: boolean;
  /** As verificações vêm da pipeline do repositório (P6); sem ela, o lint do editor é a verificação. */
  pipeline: boolean;
  checks: { summary: ChecksSummary; items: CheckView[]; stalled: boolean; pollError?: string };
};

type Options = {
  git: LocalGit;
  page: PageDoc;
  client: GitHubClient;
  lintConfig: () => Promise<Configuration>;
  config: PublishConfig;
  l10n: L10n;
  confirm: (message: string, action: string) => Promise<boolean>;
  errorText: (error: unknown) => string;
  onChange: (view: PublishView) => void;
};

/** Links do Markdown e `src` de HTML. */
const LINKS = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\bsrc=["']([^"']+)["']/g;

/**
 * O fluxo de publicação do plugin num clone local (LC5): o Git local faz branch, commit e push; a API
 * do GitHub, o PR, os checks e o "pronto para revisão". Sem `vscode` (D3-1).
 */
export class LocalPublisher {
  private repo!: Repo;
  private login!: string;
  private requiredApprovals = 0;
  private pipeline = true;
  private pr: PullRequest | null = null;
  private unverified = false;
  private busy = false;
  private notice: string | undefined;
  private error: string | undefined;
  private readonly watcher: ChecksWatcher;
  private readonly poller: Poller;

  constructor(private readonly options: Options) {
    this.watcher = new ChecksWatcher({
      client: options.client,
      startTimeoutMs: options.config.startTimeoutMs,
      onChange: state => {
        if (state.pr) this.pr = state.pr;
        this.emit();
      },
    });
    this.poller = new Poller({
      run: () => this.watcher.refresh(),
      delayMs: () => (this.watcher.active ? options.config.pollMs : options.config.idlePollMs),
    });
  }

  private get l10n() {
    return this.options.l10n;
  }

  /** Repositório, login, regras da branch principal e o PR da branch atual. */
  async load(): Promise<void> {
    const { client, git, config } = this.options;
    const repo = await client.getRepo();
    const [login, rules, hasWorkflows] = await Promise.all([
      client.getLogin(),
      client.getBranchRules(repo.defaultBranch),
      // Sem permissão para listar workflows: supõe que há pipeline (o caso mais comum)
      client.hasWorkflows().catch(() => true),
    ]);
    this.repo = repo;
    this.login = login;
    this.requiredApprovals = rules.requiredApprovals;
    this.pipeline =
      config.verificationMode === 'pipeline' ||
      (config.verificationMode === 'auto' && (hasWorkflows || rules.requiredChecks.length > 0));
    const branch = git.currentBranch();
    this.pr = branch && branch !== repo.defaultBranch ? await client.findOpenPullRequest(branch) : null;
    // PR aberto cujo último commit pulou a pipeline: falta verificar
    this.unverified = Boolean(this.pr) && (await git.headMessage()).includes(SKIP_CI);
    this.track(git.headSha());
  }

  /** O que o painel mostra agora. */
  view(): PublishView {
    const { git, page } = this.options;
    const current = git.currentBranch();
    const onDefaultBranch = !current || current === this.repo.defaultBranch;
    const state = this.watcher.current;
    return {
      page: page.path,
      branch: onDefaultBranch ? this.draftBranch : current,
      onDefaultBranch,
      defaultBranch: this.repo.defaultBranch,
      pr: this.pr?.state === 'open' ? { number: this.pr.number, url: this.pr.htmlUrl, draft: this.pr.draft } : undefined,
      unverified: this.unverified,
      busy: this.busy,
      notice: this.notice,
      error: this.error,
      sendForReview: this.requiredApprovals > 0,
      ownBranch: !onDefaultBranch && current === this.draftBranch,
      pipeline: this.pipeline,
      checks: {
        summary: summarize(state.checks),
        items: state.checks.map(run => ({
          name: run.name,
          state: run.status !== 'completed' ? 'running' : run.conclusion === 'success' || run.conclusion === 'neutral' ? 'passed' : 'failed',
          url: run.htmlUrl,
          help: failureHelp(run.name, this.options.config.checkHelp),
          annotations: (state.annotations[run.id] ?? []).map(a => {
            const { rule, description } = parseAnnotation(a);
            return {
              path: a.path,
              line: a.line,
              text: rule ? lintRuleText(rule, this.options.config.language, description) : description,
              snippet: a.snippet,
            };
          }),
        })),
        stalled: this.pipeline && state.stalled,
        pollError: state.pollError === undefined ? undefined : this.options.errorText(state.pollError),
      },
    };
  }

  setFocused(focused: boolean) {
    this.poller.setFocused(focused);
  }

  /** Consulta as verificações agora (testes e botão "Atualizar"). */
  refreshChecks() {
    return this.watcher.refresh();
  }

  dispose() {
    this.poller.dispose();
  }

  // ------------------------------------------------------------ ações

  /** "Salvar rascunho": commit da página como está, com `[skip ci]`, e push. Sem lint e sem PR. */
  saveDraft() {
    return this.run(async () => {
      const { page, git, config } = this.options;
      await page.save();
      const created = await this.ensureBranch();
      await git.refresh();
      const changed = this.changedPaths();
      if (!changed.length && created) throw new Error(this.l10n.t('Nothing to save: the page has no changes.'));
      if (changed.length) {
        const marker = config.skipCi && this.pipeline ? ` ${SKIP_CI}` : '';
        await git.commit(changed, this.l10n.t('docs: draft of "{0}"', this.title()) + marker);
        this.unverified = true;
      }
      await git.push(this.branch());
      this.notice = this.l10n.t('Draft saved to branch {0}. It has not been checked yet.', this.branch());
    });
  }

  /**
   * "Salvar e verificar": correções automáticas do lint (só trava o que sobra), commit (ou commit vazio
   * depois de um rascunho com `[skip ci]`), push e PR em rascunho na primeira vez.
   */
  saveAndVerify() {
    return this.run(async () => {
      const { page, git, client } = this.options;
      const lintConfig = await this.options.lintConfig();
      const edited = page.text();
      const content = fixLintProblems(edited, lintConfig);
      const remaining = lintFindings(content, lintConfig);
      if (remaining.length) {
        throw new Error(
          remaining.length === 1
            ? this.l10n.t('There is 1 formatting problem in the text. Fix it and save again.')
            : this.l10n.t('There are {0} formatting problems in the text. Fix them and save again.', remaining.length),
        );
      }
      if (content !== edited) await page.replaceText(content);
      await page.save();
      const created = await this.ensureBranch();
      await git.refresh();
      const changed = this.changedPaths();
      const message = this.l10n.t('docs: update "{0}"', this.title());
      if (changed.length) await git.commit(changed, message);
      else if (created) throw new Error(this.l10n.t('Nothing to save: the page has no changes.'));
      else if ((await git.headMessage()).includes(SKIP_CI)) {
        // Texto já guardado por "Salvar rascunho", que pulou a pipeline: um commit vazio a dispara
        await git.commitEmpty(message);
      }
      await git.push(this.branch());
      if (this.pr?.state !== 'open') {
        this.pr = await client.createDraftPullRequest({
          branch: this.branch(),
          base: this.repo.defaultBranch,
          title: this.l10n.t('docs: {0}', this.title()),
          body: this.l10n.t('Change to `{0}` made with the TechDocs visual editor in VS Code.', page.path),
        });
      }
      this.unverified = false;
      this.track(git.headSha());
      const adjusted = content !== edited ? ` ${this.l10n.t('The formatting was adjusted automatically.')}` : '';
      this.notice = this.pipeline
        ? this.l10n.t('Saved. The formatting is fine and the automatic checks have started.') + adjusted
        : this.l10n.t('Saved. The formatting is fine.') + adjusted;
    });
  }

  /** "Enviar": tira o PR de rascunho. Sem merge (X7): quem publica é quem faz o merge no GitHub. */
  send() {
    return this.run(async () => {
      const { client, page } = this.options;
      if (!this.pr?.draft || page.dirty || this.unverified) throw new Error(this.l10n.t('Save and check before sending.'));
      await client.markReadyForReview(this.pr.nodeId);
      this.pr = await client.getPullRequest(this.pr.number);
      this.track(this.options.git.headSha());
      this.notice =
        this.requiredApprovals > 0
          ? this.l10n.t('Pull request #{0} is ready for review. The page is published when it is approved and merged on GitHub.', this.pr.number)
          : this.l10n.t('Pull request #{0} is open. The page is published when the merge is done on GitHub.', this.pr.number);
    });
  }

  /**
   * "Descartar": fecha o PR. Na branch criada pelo painel, também apaga a branch no GitHub e a local e
   * volta para a principal, sem as alterações da página (D3-4).
   */
  async discard() {
    const { git, page, client, confirm } = this.options;
    const branch = git.currentBranch();
    const own = branch === this.draftBranch;
    const ok = await confirm(
      own
        ? this.l10n.t('Discard the draft? The branch {0} is deleted here and on GitHub, and the unpublished changes to the page are lost.', this.draftBranch)
        : this.l10n.t('Close pull request #{0}? The branch {1} stays as it is.', this.pr?.number ?? '', branch ?? ''),
      this.l10n.t('Discard'),
    );
    if (!ok) return;
    await this.run(async () => {
      if (this.pr?.state === 'open') await client.closePullRequest(this.pr.number);
      this.pr = null;
      this.unverified = false;
      if (own) {
        if (await client.getBranchSha(this.draftBranch)) await client.deleteBranch(this.draftBranch);
        await page.revert();
        await git.discardChanges([page.path]);
        await git.checkout(this.repo.defaultBranch);
        await git.deleteBranch(this.draftBranch);
      }
      this.track(undefined);
      this.notice = this.l10n.t('Draft discarded.');
    });
  }

  // ------------------------------------------------------------ apoio

  /** Branch que o painel cria para a página quando a pessoa está na principal. */
  private get draftBranch() {
    return branchFor(this.login, this.options.page.path, this.options.config.branchPattern);
  }

  private branch(): string {
    return this.options.git.currentBranch()!;
  }

  private title() {
    const { page } = this.options;
    return pageTitle(page.text()) ?? nameToTitle(page.path.split('/').pop()!);
  }

  /** Na principal, cria (ou retoma) a branch do rascunho e troca para ela. Devolve se criou. */
  private async ensureBranch(): Promise<boolean> {
    const { git } = this.options;
    const current = git.currentBranch();
    if (current && current !== this.repo.defaultBranch) return false;
    if (await git.hasLocalBranch(this.draftBranch)) {
      await git.checkout(this.draftBranch);
      return false;
    }
    await git.createBranch(this.draftBranch);
    return true;
  }

  /** Página e imagens de `<docs>/assets/` que ela usa, só os que mudaram (D3-3). */
  private changedPaths(): string[] {
    const { git, page } = this.options;
    const assets = `${page.docsDir}/assets/`;
    const linked = [...page.text().matchAll(LINKS)]
      .map(m => m[1] ?? m[2])
      .filter(url => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url))
      .map(url => resolvePath(dirOf(page.path), decodeURI(url.split('#')[0])))
      .filter(path => path.startsWith(assets));
    const paths = [page.path, ...new Set(linked)];
    const outside = git.stagedOutside(paths);
    if (outside.length) {
      throw new Error(
        this.l10n.t('Files that are not part of this page are staged ({0}). Commit them or unstage them first.', outside.join(', ')),
      );
    }
    return git.changed(paths);
  }

  /** Acompanha as verificações do PR aberto (do commit `head`), se a pipeline é a verificação. */
  private track(head: string | undefined) {
    const open = this.pr?.state === 'open' ? this.pr : null;
    this.watcher.track(this.pipeline ? open : null, open ? head : undefined);
    this.poller.setEnabled(Boolean(open) && this.pipeline);
    this.emit();
  }

  private async run(action: () => Promise<void>) {
    this.busy = true;
    this.error = undefined;
    this.notice = undefined;
    // Ao salvar, o resultado das verificações anteriores some na hora: vale só para a versão antiga (P1)
    this.watcher.clear();
    this.emit();
    try {
      await action();
    } catch (e) {
      this.error = this.options.errorText(e);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private emit() {
    if (this.repo) this.options.onChange(this.view());
  }
}
