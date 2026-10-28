import { isFailed, relevantAnnotations, snippetAt } from './checks';
import type { Annotation, CheckRun, GitHubClient, PullRequest } from './github';

/** O que o painel mostra das verificações do PR do rascunho. */
export type VerificationState = {
  pr: PullRequest | null;
  checks: CheckRun[];
  /** Apontamentos dos checks que falharam, por id do check, com o trecho de texto da linha. */
  annotations: Record<number, Annotation[]>;
  /** Erro da última consulta (quem mostra traduz); some na próxima que der certo. */
  pollError?: unknown;
  /** Nenhum check depois de `startTimeoutMs`: o GitHub não iniciou verificações. */
  stalled: boolean;
};

type Options = {
  client: GitHubClient;
  /** Sem nenhum check depois desse tempo, `stalled`. */
  startTimeoutMs: number;
  onChange: (state: VerificationState) => void;
  now?: () => number;
};

/**
 * Verificações da pipeline do PR do rascunho (o `useChecks` do plugin, sem React): checks e commit
 * statuses do último commit salvo e, para os que falharam, os apontamentos com o trecho do texto.
 */
export class ChecksWatcher {
  private state: VerificationState = { pr: null, checks: [], annotations: {}, stalled: false };
  /**
   * Commit gravado pelo último "Salvar e verificar": logo depois do commit o GitHub ainda devolve o
   * PR apontando para o commit anterior, e o painel mostraria as verificações antigas.
   */
  private expectedHead: string | undefined;
  private waitingSince: number;
  // Muda a cada salvamento: resposta de consulta iniciada antes é de um commit antigo e sai
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.waitingSince = this.now();
  }

  get current(): VerificationState {
    return this.state;
  }

  /**
   * Algo ainda pode mudar sem a pessoa fazer nada (check rodando, nenhum check ainda ou PR esperando
   * publicação): consulta no intervalo curto.
   */
  get active(): boolean {
    const { pr, checks } = this.state;
    return pr?.state === 'open' && (!pr.draft || checks.length === 0 || checks.some(r => r.status !== 'completed'));
  }

  /** PR (e commit esperado) a acompanhar. As verificações anteriores somem na hora (P1). */
  track(pr: PullRequest | null, expectedHead?: string) {
    this.generation++;
    this.expectedHead = expectedHead;
    this.waitingSince = this.now();
    this.set({
      pr: pr && expectedHead ? { ...pr, headSha: expectedHead } : pr,
      checks: [],
      annotations: {},
      pollError: undefined,
      stalled: false,
    });
  }

  /** Ao salvar, o resultado anterior some na hora: vale só para a versão antiga. */
  clear() {
    this.generation++;
    this.set({ ...this.state, checks: [], annotations: {}, pollError: undefined, stalled: false });
  }

  async refresh(): Promise<void> {
    const { client, startTimeoutMs } = this.options;
    const pr = this.state.pr;
    if (!pr || pr.state !== 'open') return;
    const generation = this.generation;
    try {
      const latest = await client.getPullRequest(pr.number);
      // Só as verificações do último commit salvo, mesmo que o PR ainda não tenha sido atualizado
      const head = this.expectedHead ?? latest.headSha;
      // Jobs pulados (ex.: publicação, que só roda na main) não são verificações do rascunho
      const checks = (await client.getVerifications(head)).filter(r => r.conclusion !== 'skipped');
      const annotations = await this.annotationsFor(checks, head);
      if (generation !== this.generation) return;
      if (latest.headSha === this.expectedHead) this.expectedHead = undefined;
      this.set({
        pr: { ...latest, headSha: head },
        checks,
        annotations: { ...this.state.annotations, ...annotations },
        pollError: undefined,
        stalled: checks.length === 0 && this.now() - this.waitingSince > startTimeoutMs,
      });
    } catch (error) {
      if (generation === this.generation) this.set({ ...this.state, pollError: error });
    }
  }

  /** Apontamentos dos checks que falharam e ainda não foram buscados (commit statuses não têm). */
  private async annotationsFor(checks: CheckRun[], head: string) {
    const { client } = this.options;
    const failed = checks.filter(r => isFailed(r) && r.source !== 'status' && !this.state.annotations[r.id]);
    // Número de linha não ajuda num editor visual: anexa o trecho de texto daquela linha
    const files = new Map<string, Promise<string | undefined>>();
    const fileAt = (path: string) => {
      if (!files.has(path)) files.set(path, client.getFile(path, head).then(f => f?.content));
      return files.get(path)!;
    };
    const entries = await Promise.all(
      failed.map(async r => {
        const found = relevantAnnotations(await client.getAnnotations(r.id));
        const withSnippets = await Promise.all(
          found.map(async a => {
            const content = await fileAt(a.path);
            return { ...a, snippet: content ? snippetAt(content, a.line) : undefined };
          }),
        );
        return [r.id, withSnippets] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  private set(state: VerificationState) {
    this.state = state;
    this.options.onChange(state);
  }
}

type PollerOptions = {
  /** Consulta. Erros são de quem chama: aqui só se agenda a próxima. */
  run: () => Promise<unknown>;
  /** Espera até a próxima consulta, decidida depois de cada uma (ex.: 8 s com check rodando, 60 s parado). */
  delayMs: () => number;
};

/**
 * Consulta periódica com o intervalo escolhido depois de cada consulta. Sem foco (a janela do VS Code
 * em segundo plano), nada é consultado; ao voltar, consulta na hora (P8).
 */
export class Poller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private enabled = false;
  private focused = true;

  constructor(private readonly options: PollerOptions) {}

  /** Liga (consulta na hora) ou desliga. Ligar de novo recomeça. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) void this.tick();
    else clearTimeout(this.timer);
  }

  setFocused(focused: boolean) {
    if (focused === this.focused) return;
    this.focused = focused;
    if (!focused) clearTimeout(this.timer);
    else if (this.enabled) void this.tick();
  }

  dispose() {
    this.enabled = false;
    clearTimeout(this.timer);
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.enabled && this.focused) this.timer = setTimeout(() => void this.tick(), this.options.delayMs());
  }

  private async tick() {
    if (!this.enabled || !this.focused || this.running) return;
    this.running = true;
    try {
      await this.options.run();
    } catch {
      // quem chama mostra o erro; a consulta segue
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}
