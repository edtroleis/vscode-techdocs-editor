import { GitHubClient, userTransport } from '@edtroleis/techdocs-editor-core';
import { FakeCommit, FakeGitHub } from '../../../core/test/fakeGitHub';
import { LocalPublisher, PublishConfig, PublishView } from './localPublisher';
import type { LocalGit, PageDoc } from './types';

const INDEX = '# Início\n\nTexto da página.\n';
const OTHER = '# Outra\n\nOutra página.\n';

/** Clone local simulado: árvore de trabalho, índice e branches; o push chega ao GitHub simulado. */
class FakeGit implements LocalGit {
  readonly branches = new Map<string, FakeCommit>();
  current = 'main';
  work: Record<string, string>;
  readonly staged = new Set<string>();
  constructor(private readonly github: FakeGitHub) {
    const main = github.head('main')!;
    this.branches.set('main', main);
    this.work = { ...main.files };
  }
  private get head() {
    return this.branches.get(this.current)!;
  }
  refresh = async () => {};
  remoteUrl = () => `https://github.com/${this.github.slug}.git`;
  currentBranch = () => this.current;
  headSha = () => this.head.sha;
  headMessage = async () => this.head.message;
  hasLocalBranch = async (name: string) => this.branches.has(name);
  changed = (paths: string[]) => paths.filter(p => this.work[p] !== undefined && this.work[p] !== this.head.files[p]);
  stagedOutside = (paths: string[]) => [...this.staged].filter(p => !paths.includes(p));
  async createBranch(name: string) {
    this.branches.set(name, this.head);
    this.current = name;
  }
  async checkout(name: string) {
    const before = this.head.files;
    const target = this.branches.get(name)!;
    const work = { ...target.files };
    // Como o git: as alterações não commitadas vão junto
    for (const [path, content] of Object.entries(this.work)) if (content !== before[path]) work[path] = content;
    this.work = work;
    this.current = name;
  }
  async deleteBranch(name: string) {
    this.branches.delete(name);
  }
  async commit(paths: string[], message: string) {
    const files = { ...this.head.files };
    for (const p of paths) files[p] = this.work[p];
    this.branches.set(this.current, this.github.commit(message, files));
  }
  async commitEmpty(message: string) {
    this.branches.set(this.current, this.github.commit(message, this.head.files));
  }
  async push(branch: string) {
    this.github.push(branch, this.branches.get(branch)!);
  }
  async discardChanges(paths: string[]) {
    for (const p of paths) this.work[p] = this.head.files[p];
  }
}

/** Página aberta no editor: texto não salvo até `save`. */
class FakePage implements PageDoc {
  buffer: string | undefined;
  constructor(private readonly git: FakeGit, readonly path = 'docs/index.md', readonly docsDir = 'docs') {}
  text = () => this.buffer ?? this.git.work[this.path];
  get dirty() {
    return this.buffer !== undefined && this.buffer !== this.git.work[this.path];
  }
  edit(text: string) {
    this.buffer = text;
  }
  async save() {
    if (this.buffer !== undefined) this.git.work[this.path] = this.buffer;
    this.buffer = undefined;
  }
  async replaceText(text: string) {
    this.buffer = text;
  }
  async revert() {
    this.buffer = undefined;
  }
}

const CONFIG: PublishConfig = {
  branchPattern: 'docs/{login}/{path}',
  skipCi: true,
  verificationMode: 'auto',
  startTimeoutMs: 120_000,
  pollMs: 8000,
  idlePollMs: 60_000,
  checkHelp: {},
  language: 'en',
};
const l10n = { t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) };

async function setup({ files = {}, config = {} }: { files?: Record<string, string>; config?: Partial<PublishConfig> } = {}) {
  const github = new FakeGitHub({ 'docs/index.md': INDEX, 'docs/outra.md': OTHER, ...files });
  const git = new FakeGit(github);
  const page = new FakePage(git);
  const client = new GitHubClient({ ...userTransport(github.token), fetch: github.fetch }, github.slug);
  let view: PublishView | undefined;
  const confirm = vi.fn(async () => true);
  const publisher = new LocalPublisher({
    git,
    page,
    client,
    lintConfig: async () => ({ default: true, MD013: false }),
    config: { ...CONFIG, ...config },
    l10n,
    confirm,
    errorText: e => (e instanceof Error ? e.message : String(e)),
    onChange: v => (view = v),
  });
  await publisher.load();
  return { github, git, page, publisher, confirm, view: () => view! };
}

const BRANCH = 'docs/pessoa-teste/docs-index';

describe('painel de publicação no modo local', () => {
  afterEach(() => vi.useRealTimers());

  it('na branch principal: mostra a branch que o rascunho vai usar', async () => {
    const { view } = await setup();
    expect(view()).toMatchObject({ onDefaultBranch: true, branch: BRANCH, pr: undefined, pipeline: true });
  });

  it('Salvar rascunho: cria a branch, commit com [skip ci] e push; sem PR e sem pipeline', async () => {
    const { github, git, page, publisher, view } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveDraft();
    expect(view().error).toBeUndefined();
    expect(git.current).toBe(BRANCH);
    const pushed = github.head(BRANCH)!;
    expect(pushed.message).toBe('docs: draft of "Início" [skip ci]');
    expect(pushed.files['docs/index.md']).toContain('Mais texto.');
    expect(github.pulls).toEqual([]);
    expect(github.pipelineRuns).toEqual([]);
    expect(view()).toMatchObject({ onDefaultBranch: false, unverified: true, ownBranch: true });
  });

  it('Salvar rascunho sem alteração não cria nada', async () => {
    const { github, publisher, view } = await setup();
    await publisher.saveDraft();
    expect(view().error).toContain('Nothing to save');
    expect(github.refs.has(BRANCH)).toBe(false);
  });

  it('Salvar e verificar depois de um rascunho: commit vazio dispara a pipeline e abre o PR em rascunho', async () => {
    const { github, git, page, publisher, view } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveDraft();
    await publisher.saveAndVerify();
    expect(view().error).toBeUndefined();
    expect(github.head(BRANCH)!.message).toBe('docs: update "Início"');
    expect(github.pulls).toEqual([expect.objectContaining({ head: BRANCH, base: 'main', draft: true, title: 'docs: Início' })]);
    expect(github.pipelineRuns).toEqual([git.headSha()]);
    await publisher.refreshChecks();
    expect(view()).toMatchObject({ unverified: false, pr: { number: 1, draft: true }, checks: { summary: 'passed' } });
  });

  it('Salvar e verificar ajusta a formatação sozinho e salva o texto ajustado', async () => {
    const { github, page, publisher, view } = await setup();
    page.edit('# Início\n\n#Título sem espaço\n\nTexto.\n');
    await publisher.saveAndVerify();
    expect(view().error).toBeUndefined();
    expect(view().notice).toContain('adjusted automatically');
    expect(github.head(BRANCH)!.files['docs/index.md']).toContain('# Título sem espaço');
  });

  it('Salvar e verificar trava no que não tem correção automática, sem commit', async () => {
    const { github, page, publisher, view } = await setup();
    page.edit('# Início\n\n![](foto.png)\n');
    await publisher.saveAndVerify();
    expect(view().error).toBe('There is 1 formatting problem in the text. Fix it and save again.');
    expect(github.refs.has(BRANCH)).toBe(false);
  });

  it('o commit leva a página e as imagens novas que ela usa, e nada mais (D3-3)', async () => {
    const { github, git, page, publisher } = await setup();
    git.work['docs/assets/1-foto.png'] = 'PNG';
    git.work['docs/assets/2-outra.png'] = 'PNG';
    git.work['docs/outra.md'] = `${OTHER}\nAlterada fora do painel.\n`;
    page.edit(`${INDEX}\n![Foto](assets/1-foto.png)\n`);
    await publisher.saveDraft();
    const files = github.head(BRANCH)!.files;
    expect(files['docs/assets/1-foto.png']).toBe('PNG');
    expect(files['docs/assets/2-outra.png']).toBeUndefined();
    expect(files['docs/outra.md']).toBe(OTHER);
  });

  it('arquivo de fora da página no índice: não faz commit', async () => {
    const { github, git, page, publisher, view } = await setup();
    git.staged.add('docs/outra.md');
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveDraft();
    expect(view().error).toContain('docs/outra.md');
    expect(github.refs.has(BRANCH)).toBe(false);
  });

  it('Enviar só depois de verificar; com aprovações exigidas, vai para revisão', async () => {
    const { github, page, publisher, view } = await setup();
    github.requiredApprovals = 1;
    await publisher.load();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveDraft();
    await publisher.send();
    expect(view().error).toBe('Save and check before sending.');
    await publisher.saveAndVerify();
    await publisher.send();
    expect(view().error).toBeUndefined();
    expect(github.pulls[0].draft).toBe(false);
    expect(view()).toMatchObject({ sendForReview: true, pr: { draft: false } });
    expect(view().notice).toContain('ready for review');
  });

  it('check que falhou: apontamento em linguagem simples com a linha', async () => {
    const { github, page, publisher, view } = await setup();
    github.nextOutcome = {
      'Formatação do texto': {
        conclusion: 'failure',
        annotations: [{ path: 'docs/index.md', line: 3, message: 'docs/index.md:3 MD009/no-trailing-spaces Trailing spaces [Expected: 0; Actual: 1]' }],
      },
    };
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveAndVerify();
    await publisher.refreshChecks();
    const failed = view().checks.items.find(c => c.state === 'failed')!;
    expect(view().checks.summary).toBe('failed');
    expect(failed.annotations).toEqual([expect.objectContaining({ line: 3, snippet: 'Texto da página.' })]);
    expect(failed.annotations[0].text).not.toContain('MD009');
  });

  it('Descartar na branch do painel: fecha o PR, apaga as branches e volta à principal com a página original', async () => {
    const { github, git, page, publisher, view, confirm } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveAndVerify();
    page.edit(`${INDEX}\nNão salvo.\n`);
    await publisher.discard();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(BRANCH), 'Discard');
    expect(github.pulls[0].state).toBe('closed');
    expect(github.refs.has(BRANCH)).toBe(false);
    expect(git.current).toBe('main');
    expect(git.branches.has(BRANCH)).toBe(false);
    expect(page.text()).toBe(INDEX);
    expect(view()).toMatchObject({ onDefaultBranch: true, pr: undefined, notice: 'Draft discarded.' });
  });

  it('Descartar numa branch da própria pessoa: só fecha o PR (D3-4)', async () => {
    const { github, git, page, publisher } = await setup();
    await git.createBranch('minha-branch');
    await publisher.load();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveAndVerify();
    expect(github.pulls[0].head).toBe('minha-branch');
    await publisher.discard();
    expect(github.pulls[0].state).toBe('closed');
    expect(github.refs.has('minha-branch')).toBe(true);
    expect(git.current).toBe('minha-branch');
  });

  it('Descartar cancelado não muda nada', async () => {
    const { github, page, publisher, confirm } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveAndVerify();
    confirm.mockResolvedValueOnce(false);
    await publisher.discard();
    expect(github.pulls[0].state).toBe('open');
  });

  it('sem pipeline: rascunho sem [skip ci] e o lint do editor é a verificação (P6)', async () => {
    const { github, page, publisher, view } = await setup();
    github.hasPipeline = false;
    await publisher.load();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveDraft();
    expect(github.head(BRANCH)!.message).not.toContain('[skip ci]');
    await publisher.saveAndVerify();
    expect(view()).toMatchObject({ pipeline: false, checks: { stalled: false } });
    expect(view().notice).toBe('Saved. The formatting is fine.');
  });

  it('retoma o PR aberto da branch atual ao abrir o painel', async () => {
    const first = await setup();
    first.page.edit(`${INDEX}\nMais texto.\n`);
    await first.publisher.saveAndVerify();
    await first.publisher.load();
    expect(first.view()).toMatchObject({ pr: { number: 1, draft: true }, unverified: false, ownBranch: true });
  });

  it('erro do GitHub aparece no painel', async () => {
    const { github, page, publisher, view } = await setup();
    github.failNext('POST', /\/pulls$/, 403, 'Resource not accessible by integration');
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveAndVerify();
    expect(view().error).toBe('Resource not accessible by integration');
    expect(view().busy).toBe(false);
  });
});
