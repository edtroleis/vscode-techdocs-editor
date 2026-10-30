import {
  applicableSteps,
  applySetup,
  branchFor,
  ChecksSummary,
  ChecksWatcher,
  dirOf,
  failureHelp,
  fixLintProblems,
  GitHubClient,
  lintFindings,
  lintRuleText,
  LINT_CONFIG_FILES,
  MainConflict,
  MainSync,
  OpenPullRequest,
  pageTitle,
  nameToTitle,
  parseAnnotation,
  planSetup,
  Poller,
  PullRequest,
  Repo,
  resolvePath,
  SetupStep,
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
  /** O rascunho e a versão publicada mudaram o mesmo trecho (modo remoto, 4e): falta resolver. */
  conflict?: boolean;
  /** O PR desta página teve o merge feito no GitHub: a página está publicada. */
  published?: { number: number; url: string };
  /**
   * "Enviar para revisão" em um passo: `saving` (formatação, commit, PR em rascunho), `checking` (esperando
   * as verificações passarem) e `sending` (marcando o PR como pronto). Undefined fora do envio.
   */
  submitting?: 'saving' | 'checking' | 'sending';
  /** PRs abertos de outras pessoas que mudam esta página (M9). */
  othersPrs: Array<{ number: number; url: string; author: string }>;
  /** PRs da própria pessoa que mudam esta página, abertos fora do painel (outra branch). */
  ownPrs: Array<{ number: number; url: string }>;
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
  /** "Configurar verificações" (P7, só admin): o que falta no repositório e o PR do que foi aplicado. */
  setup?: { steps: SetupStep[]; pullRequest?: { number: number; url: string } };
};

export type LocalPublisherOptions = {
  git: LocalGit;
  page: PageDoc;
  client: GitHubClient;
  /** Cliente com o escopo `workflow`, pedido só ao configurar as verificações (A-3). */
  workflowClient: () => Promise<GitHubClient>;
  lintConfig: () => Promise<Configuration>;
  config: PublishConfig;
  l10n: L10n;
  confirm: (message: string, action: string) => Promise<boolean>;
  errorText: (error: unknown) => string;
  onChange: (view: PublishView) => void;
  /** Modo remoto (4e): traz para o rascunho o que foi publicado depois que ele começou (`syncWithMain`). */
  sync?: () => Promise<MainSync>;
  /** Abre a tela de conflito com a versão publicada e grava a escolha; false se a pessoa cancelou. */
  resolve?: (conflict: MainConflict) => Promise<boolean>;
};

/** Links do Markdown e `src` de HTML. */
/** Arquivos do site ao lado do `mkdocs.yml` que vão junto com o site novo. */
const SITE_FILES = new Set(['catalog-info.yaml', 'README.md', ...LINT_CONFIG_FILES]);
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
  private setup: PublishView['setup'];
  private conflict: MainConflict | undefined;
  private otherPrs: OpenPullRequest[] = [];
  private submitting: PublishView['submitting'];
  private readonly watcher: ChecksWatcher;
  private readonly poller: Poller;

  constructor(private readonly options: LocalPublisherOptions) {
    this.watcher = new ChecksWatcher({
      client: options.client,
      startTimeoutMs: options.config.startTimeoutMs,
      onChange: state => {
        if (state.pr) this.pr = state.pr;
        this.emit();
        void this.sendWhenChecked();
      },
    });
    this.poller = new Poller({
      run: () => (this.pipeline ? this.watcher.refresh() : this.refreshPr()),
      delayMs: () => (this.pipeline && this.watcher.active ? options.config.pollMs : options.config.idlePollMs),
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
    // No rascunho de outra página, o PR desta é o da branch dela (se ela já tem uma)
    this.pr = this.onBase(branch)
      ? branch && branch !== repo.defaultBranch
        ? await client.findOpenPullRequest(this.draftBranch)
        : null
      : await client.findOpenPullRequest(branch!);
    // PR aberto cujo último commit pulou a pipeline: falta verificar
    this.unverified = Boolean(this.pr) && (await git.headMessage()).includes(SKIP_CI);
    // Sem admin, nada a oferecer; erro ao consultar só esconde a oferta
    const plan = repo.isAdmin ? await planSetup(client).catch(() => undefined) : undefined;
    const steps = plan ? applicableSteps(plan) : [];
    this.setup = steps.length ? { steps } : undefined;
    // Outros PRs abertos na mesma página (M9); erro ao consultar só esconde o aviso
    this.otherPrs = (await client.findOpenPullRequestsForFile(this.options.page.path).catch(() => [])).filter(
      p => p.number !== this.pr?.number && p.branch !== branch && p.branch !== this.draftBranch,
    );
    // O que foi publicado enquanto o rascunho existia: entra sozinho, ou o conflito aparece no painel
    if (!this.onBase(branch)) await this.syncMain().catch(() => false);
    this.track(git.headSha());
  }

  /** O que o painel mostra agora. */
  view(): PublishView {
    const { git, page } = this.options;
    const current = git.currentBranch();
    const onDefaultBranch = this.onBase(current);
    const state = this.watcher.current;
    return {
      page: page.path,
      branch: onDefaultBranch ? this.draftBranch : current!,
      onDefaultBranch,
      defaultBranch: this.repo.defaultBranch,
      pr: this.pr?.state === 'open' ? { number: this.pr.number, url: this.pr.htmlUrl, draft: this.pr.draft } : undefined,
      published: this.pr?.merged ? { number: this.pr.number, url: this.pr.htmlUrl } : undefined,
      conflict: Boolean(this.conflict),
      submitting: this.submitting,
      othersPrs: this.otherPrs.filter(p => p.author !== this.login).map(p => ({ number: p.number, url: p.htmlUrl, author: p.author })),
      ownPrs: this.otherPrs.filter(p => p.author === this.login).map(p => ({ number: p.number, url: p.htmlUrl })),
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
      setup: this.setup,
    };
  }

  setFocused(focused: boolean) {
    this.poller.setFocused(focused);
  }

  /**
   * A página foi salva fora do painel (Ctrl+S): na página do GitHub, o salvar grava o rascunho (cria a branch na
   * primeira vez); lê de novo para a faixa dizer "Rascunho".
   */
  async pageSaved() {
    if (this.busy) return;
    await this.options.git.refresh();
    this.emit();
  }

  /** Consulta as verificações agora (testes e botão "Atualizar"). */
  refreshChecks() {
    return this.pipeline ? this.watcher.refresh() : this.refreshPr();
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
      if (await this.syncMain()) this.notice += ` ${this.conflictText()}`;
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
      // Com conflito, a pipeline não rodaria (o GitHub Actions não roda em PR com conflito): resolver antes
      if (await this.syncMain()) {
        this.unverified = true;
        this.notice = `${this.l10n.t('Saved.')} ${this.conflictText()}`;
        return;
      }
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
      if (!this.pr?.draft || page.dirty || this.unverified || this.conflict) throw new Error(this.l10n.t('Save and check before sending.'));
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
   * "Enviar para revisão" (um passo só, para quem escreve): salva e verifica e, quando as verificações passam,
   * marca o PR como pronto. Sem pipeline, o lint do editor é a verificação e o envio é na hora.
   */
  async submit() {
    this.submitting = 'saving';
    await this.saveAndVerify();
    if (this.error || this.conflict || this.unverified || this.pr?.state !== 'open') {
      this.submitting = undefined;
      this.emit();
      return;
    }
    this.submitting = 'checking';
    this.emit();
    await this.sendWhenChecked();
  }

  /** No envio em um passo: verificações passaram, marca como pronto; falharam, para (a faixa mostra o motivo). */
  private async sendWhenChecked() {
    if (this.submitting !== 'checking' || this.busy) return;
    if (!this.pr?.draft) {
      this.submitting = undefined;
      return this.emit();
    }
    const summary = summarize(this.watcher.current.checks);
    if (this.pipeline && summary !== 'passed') {
      if (summary === 'failed') {
        this.submitting = undefined;
        this.emit();
      }
      return;
    }
    this.submitting = 'sending';
    await this.send();
    this.submitting = undefined;
    this.emit();
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

  /** "Resolver conflito" (4e): a tela de escolha e o commit de merge do rascunho com a versão publicada. */
  resolveConflict() {
    return this.run(async () => {
      const conflict = this.conflict;
      if (!conflict || !this.options.resolve) return;
      if (!(await this.options.resolve(conflict))) return;
      this.conflict = undefined;
      await this.options.git.refresh();
      // O commit de merge mantém o [skip ci] de um rascunho não verificado; sem ele, a pipeline roda de novo
      const verified = this.pr?.state === 'open' && !this.unverified;
      if (verified) this.track(this.options.git.headSha());
      else this.unverified = true;
      this.notice = verified
          ? this.l10n.t('Conflict resolved. The automatic checks have started again.')
          : this.l10n.t('Conflict resolved. Save and check to send the page.');
    });
  }

  /**
   * "Configurar verificações" (P7): merge por squash e ruleset na hora; workflow e regras do lint num
   * PR para o time revisar. O escopo `workflow` só é pedido se o workflow vai no PR.
   */
  async setUp() {
    const { client, confirm } = this.options;
    const ok = await confirm(
      this.l10n.t('Set up this repository? Merge settings and branch protection change now; the new files go in a pull request for the team to review.'),
      this.l10n.t('Set up checks'),
    );
    if (!ok) return;
    await this.run(async () => {
      const plan = await planSetup(client);
      const writer = applicableSteps(plan).includes('workflow') ? await this.options.workflowClient() : client;
      const result = await applySetup(writer, plan, {
        requiredApprovals: this.requiredApprovals,
        prTitle: this.l10n.t('Set up checks for the docs editor'),
        prBody: this.l10n.t(
          'Adds what the docs editor needs to check every change before it is published: automatic checks on pull requests (text formatting, links, sensitive data and the docs build) and the formatting rules the editor shows while people write. After this merge, the main branch can require these checks.',
        ),
        commitMessage: this.l10n.t('ci: checks for the docs editor'),
      });
      const pr = result.pullRequest;
      // O que ficou no PR continua faltando até o merge: não oferece de novo
      this.setup = { steps: [], pullRequest: pr && { number: pr.number, url: pr.htmlUrl } };
      this.notice = pr
        ? this.l10n.t('Repository set up. The new files are in pull request #{0}: merge it to turn on the checks.', pr.number)
        : this.l10n.t('Repository set up.');
    });
  }

  // ------------------------------------------------------------ apoio

  /** Traz a versão publicada para o rascunho (só no modo remoto). Devolve se ficou um conflito para resolver. */
  private async syncMain(): Promise<boolean> {
    if (!this.options.sync) return false;
    const synced = await this.options.sync();
    this.conflict = synced.kind === 'conflict' ? synced.conflict : undefined;
    if (synced.kind === 'updated') await this.options.git.refresh();
    return Boolean(this.conflict);
  }

  private conflictText() {
    return this.l10n.t('But another change to this page was published and changed the same passage: resolve the conflict to continue.');
  }

  /** Branch que o painel cria para a página quando a pessoa está na principal. */
  private get draftBranch() {
    return branchFor(this.login, this.options.page.path, this.options.config.branchPattern);
  }

  /**
   * Na principal ou no rascunho de outra página (a branch que o painel criou para ela): esta página vai para a
   * branch dela, criada a partir da principal. Numa branch que a pessoa criou, a página vai nela.
   */
  private onBase(branch: string | undefined) {
    if (!branch || branch === this.repo.defaultBranch) return true;
    if (branch === this.draftBranch) return false;
    const [before, after] = this.options.config.branchPattern
      .replace('{login}', this.login)
      .split('{path}')
      .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return after !== undefined && new RegExp(`^${before}.+${after}$`).test(branch);
  }

  private branch(): string {
    return this.options.git.currentBranch()!;
  }

  private title() {
    const { page } = this.options;
    return pageTitle(page.text()) ?? nameToTitle(page.path.split('/').pop()!);
  }

  /** Na principal (ou no rascunho de outra página), cria (ou retoma) a branch do rascunho e troca para ela. Devolve se criou. */
  private async ensureBranch(): Promise<boolean> {
    const { git } = this.options;
    const current = git.currentBranch();
    if (!this.onBase(current)) return false;
    if (await git.hasLocalBranch(this.draftBranch)) {
      await git.checkout(this.draftBranch);
      return false;
    }
    // No rascunho de outra página, a partir da principal: o PR desta não leva os commits da outra
    await git.createBranch(this.draftBranch, current && current !== this.repo.defaultBranch ? this.repo.defaultBranch : undefined);
    return true;
  }

  /** Página e imagens de `<docs>/assets/` que ela usa, só os que mudaram (D3-3). */
  /**
   * O que vai com a página para ela funcionar no GitHub: enquanto o site é novo (o `mkdocs.yml` fora do Git), o site
   * inteiro (o `mkdocs.yml`, as páginas e os arquivos do site ao lado dele); com a página nova, o `mkdocs.yml`, que
   * tem a entrada dela no menu.
   */
  private siteFiles(): string[] {
    const { git, page } = this.options;
    if (!page.mkdocs) return [];
    if (git.tracked(page.mkdocs)) return git.tracked(page.path) ? [] : [page.mkdocs];
    const root = dirOf(page.mkdocs);
    return git
      .changedFiles()
      .filter(path => path === page.mkdocs || path.startsWith(`${page.docsDir}/`) || (dirOf(path) === root && SITE_FILES.has(path.slice(path.lastIndexOf('/') + 1))));
  }

  private changedPaths(): string[] {
    const { git, page } = this.options;
    const assets = `${page.docsDir}/assets/`;
    const linked = [...page.text().matchAll(LINKS)]
      .map(m => m[1] ?? m[2])
      .filter(url => !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url))
      .map(url => resolvePath(dirOf(page.path), decodeURI(url.split('#')[0])))
      .filter(path => path.startsWith(assets));
    const paths = [page.path, ...new Set(linked), ...this.siteFiles()];
    const outside = git.stagedOutside(paths);
    if (outside.length) {
      throw new Error(
        this.l10n.t('Files that are not part of this page are staged ({0}). Commit them or unstage them first.', outside.join(', ')),
      );
    }
    return git.changed(paths);
  }

  /**
   * Acompanha as verificações do PR aberto (do commit `head`), se a pipeline é a verificação. Sem pipeline, só o
   * estado do PR, mais devagar: o merge no GitHub aparece como publicado sem reabrir a página.
   */
  private track(head: string | undefined) {
    const open = this.pr?.state === 'open' ? this.pr : null;
    this.watcher.track(this.pipeline ? open : null, open ? head : undefined);
    this.poller.setEnabled(Boolean(open));
    this.emit();
  }

  /** Sem pipeline: o PR de novo do GitHub (merge, fechado); erro na consulta fica para a próxima. */
  private async refreshPr() {
    const pr = this.pr;
    if (pr?.state !== 'open') return;
    const latest = await this.options.client.getPullRequest(pr.number).catch(() => undefined);
    if (!latest || this.pr !== pr) return;
    this.pr = latest;
    if (latest.state !== 'open') this.poller.setEnabled(false);
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
