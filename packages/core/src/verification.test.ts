import { FakeGitHub } from '../test/fakeGitHub';
import { GitHubClient, userTransport } from './github';
import { ChecksWatcher, Poller, VerificationState } from './verification';

const PAGE = '# Início\n\nTexto da página.\n\nOutra linha com detalhe.\n';

function setup() {
  const github = new FakeGitHub({ 'docs/index.md': PAGE });
  const client = new GitHubClient({ ...userTransport(github.token), fetch: github.fetch }, github.slug);
  let now = 0;
  const states: VerificationState[] = [];
  const watcher = new ChecksWatcher({ client, startTimeoutMs: 1000, onChange: s => states.push(s), now: () => now });
  const draft = async (message = 'docs: altera') => {
    github.push('docs/ana/x', github.commit(message, { 'docs/index.md': PAGE.replace('Texto', 'Texto novo') }));
    if (!github.openPull('docs/ana/x')) {
      await client.createDraftPullRequest({ branch: 'docs/ana/x', base: 'main', title: 't', body: '' });
    }
    return client.findOpenPullRequest('docs/ana/x');
  };
  return { github, client, watcher, states, draft, advance: (ms: number) => (now += ms) };
}

describe('ChecksWatcher', () => {
  it('checks do commit do PR; todos passaram', async () => {
    const { watcher, draft } = setup();
    watcher.track(await draft());
    await watcher.refresh();
    expect(watcher.current.checks.map(c => c.conclusion)).toEqual(['success', 'success', 'success', 'success']);
    // PR em rascunho com tudo terminado: consulta no intervalo longo
    expect(watcher.active).toBe(false);
  });

  it('check que falhou traz os apontamentos com o trecho do texto da linha (P3)', async () => {
    const { github, watcher, draft } = setup();
    github.nextOutcome = {
      'Formatação do texto': {
        conclusion: 'failure',
        annotations: [{ path: 'docs/index.md', line: 5, message: 'docs/index.md:5 MD009/no-trailing-spaces Trailing spaces' }],
      },
    };
    watcher.track(await draft());
    await watcher.refresh();
    const failed = watcher.current.checks.find(c => c.conclusion === 'failure')!;
    expect(watcher.current.annotations[failed.id]).toEqual([
      expect.objectContaining({ line: 5, snippet: 'Outra linha com detalhe.' }),
    ]);
  });

  it('commit statuses de CI externo (P2)', async () => {
    const { github, watcher, draft } = setup();
    github.pipelineKind = 'external';
    watcher.track(await draft());
    await watcher.refresh();
    expect(watcher.current.checks).toEqual([expect.objectContaining({ name: 'continuous-integration/jenkins/pr-merge', source: 'status' })]);
  });

  it('sem check depois do tempo de início: stalled (P4)', async () => {
    const { github, watcher, draft, advance } = setup();
    github.hasPipeline = false;
    watcher.track(await draft());
    await watcher.refresh();
    expect(watcher.current.stalled).toBe(false);
    expect(watcher.active).toBe(true);
    advance(1500);
    await watcher.refresh();
    expect(watcher.current.stalled).toBe(true);
  });

  it('PR ainda no commit anterior: mostra as verificações do commit salvo (P1)', async () => {
    const { github, watcher, draft } = setup();
    const pr = await draft();
    github.prHeadLag = 2;
    github.pipelineStartDelay = 1;
    await draft('docs: altera de novo');
    const saved = github.refs.get('docs/ana/x')!;
    watcher.track(pr, saved);
    await watcher.refresh();
    expect(watcher.current.pr!.headSha).toBe(saved);
    expect(watcher.current.checks).toEqual([]);
    await watcher.refresh();
    expect(watcher.current.checks).toHaveLength(4);
  });

  it('resposta de consulta iniciada antes de salvar é descartada (P1)', async () => {
    const { watcher, draft } = setup();
    watcher.track(await draft());
    const pending = watcher.refresh();
    watcher.clear();
    await pending;
    expect(watcher.current.checks).toEqual([]);
  });

  it('erro na consulta fica no estado e some na próxima (P5)', async () => {
    const { github, watcher, draft } = setup();
    watcher.track(await draft());
    github.failNext('GET', /check-runs/, 500, 'Server Error');
    await watcher.refresh();
    expect(String(watcher.current.pollError)).toContain('Server Error');
    await watcher.refresh();
    expect(watcher.current.pollError).toBeUndefined();
  });

  it('consultas repetidas usam ETag: 304 não conta no limite (P9)', async () => {
    const { github, watcher, draft } = setup();
    watcher.track(await draft());
    await watcher.refresh();
    await watcher.refresh();
    expect(github.notModified.some(c => c.includes('check-runs'))).toBe(true);
  });
});

describe('Poller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('consulta na hora, reagenda pelo intervalo e para sem foco (P8)', async () => {
    const run = vi.fn(async () => {});
    const poller = new Poller({ run, delayMs: () => 8000 });
    poller.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(run).toHaveBeenCalledTimes(2);
    poller.setFocused(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    // Ao voltar o foco, consulta na hora
    poller.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    poller.dispose();
  });
});
