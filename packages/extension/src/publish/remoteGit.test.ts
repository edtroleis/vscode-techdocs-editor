import {
  commitResolution,
  GitHubClient,
  loadRemoteSession,
  MainConflict,
  RemoteSession,
  resolveChunks,
  saveRemoteDraft,
  syncWithMain,
  userTransport,
} from '@edtroleis/techdocs-editor-core';
import { FakeGitHub } from '../../../core/test/fakeGitHub';
import { LocalPublisher, PublishConfig, PublishView } from './localPublisher';
import { RemoteGit } from './remoteGit';
import type { PageDoc } from './types';

const INDEX = '# Início\n\nTexto da página.\n';
const BRANCH = 'docs/pessoa-teste/docs-index';

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

/** A página aberta do GitHub: salvar é o Ctrl+S do esquema techdocs: (commit do rascunho, 4c). */
class RemotePage implements PageDoc {
  buffer: string | undefined;
  readonly path = 'docs/index.md';
  readonly docsDir = 'docs';
  constructor(
    private readonly holder: { session: RemoteSession },
    private readonly client: GitHubClient,
  ) {}
  text = () => this.buffer ?? this.holder.session.content;
  get dirty() {
    return this.buffer !== undefined && this.buffer !== this.holder.session.content;
  }
  edit(text: string) {
    this.buffer = text;
  }
  async save() {
    if (this.buffer === undefined) return;
    const text = this.buffer;
    this.buffer = undefined;
    this.holder.session = (await saveRemoteDraft(this.client, this.holder.session, text, { message: 'docs: draft of "Início"' })).session;
  }
  async replaceText(text: string) {
    this.buffer = text;
  }
  async revert() {
    this.buffer = undefined;
  }
}

async function setup(choose?: (conflict: MainConflict) => 'mine' | 'theirs' | undefined) {
  const github = new FakeGitHub({ 'docs/index.md': INDEX });
  const client = new GitHubClient({ ...userTransport(github.token), fetch: github.fetch }, github.slug);
  const load = () => loadRemoteSession(client, { filePath: 'docs/index.md', docsDir: 'docs' }, { login: github.login });
  const holder = { session: await load() };
  const page = new RemotePage(holder, client);
  const git = new RemoteGit({
    client,
    defaultBranch: 'main',
    draftBranch: BRANCH,
    remoteUrl: `https://github.com/${github.slug}.git`,
    session: () => holder.session,
    reload: async () => {
      holder.session = await load();
    },
  });
  await git.refresh();
  let view: PublishView | undefined;
  const publisher = new LocalPublisher({
    git,
    page,
    client,
    workflowClient: async () => client,
    lintConfig: async () => ({ default: true, MD013: false }),
    config: CONFIG,
    l10n,
    confirm: async () => true,
    errorText: e => (e instanceof Error ? e.message : String(e)),
    onChange: v => (view = v),
    sync: async () => {
      const synced = await syncWithMain(client, { branch: BRANCH, base: 'main', filePath: 'docs/index.md' });
      if (synced.kind === 'updated') holder.session = await load();
      return synced;
    },
    resolve: async conflict => {
      const choice = choose?.(conflict);
      if (!choice) return false;
      const text = resolveChunks(conflict.chunks, [choice]);
      await commitResolution(client, { branch: BRANCH, base: 'main', filePath: 'docs/index.md' }, conflict, text, 'docs: merge');
      holder.session = await load();
      return true;
    },
  });
  await publisher.load();
  return { github, page, publisher, holder, view: () => view! };
}

describe('painel de publicação no modo remoto (RemoteGit)', () => {
  it('sem rascunho: mostra a branch que o rascunho vai usar', async () => {
    const { view } = await setup();
    expect(view()).toMatchObject({ onDefaultBranch: true, branch: BRANCH, pr: undefined });
  });

  it('Salvar rascunho: o commit do Ctrl+S com [skip ci]; sem PR e sem pipeline; fica "não verificado"', async () => {
    const { github, page, publisher, view } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveDraft();
    expect(view().error).toBeUndefined();
    expect(github.head(BRANCH)!.message).toBe('docs: draft of "Início" [skip ci]');
    expect(view()).toMatchObject({ onDefaultBranch: false, ownBranch: true, unverified: true, pr: undefined });
    expect(github.pipelineRuns).toEqual([]);
  });

  it('Salvar e verificar depois do Ctrl+S: commit vazio sem [skip ci], PR em rascunho e a pipeline roda; Enviar', async () => {
    const { github, page, publisher, view } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await page.save();
    await publisher.saveAndVerify();
    expect(view().error).toBeUndefined();
    const head = github.head(BRANCH)!;
    expect(head.message).toBe('docs: update "Início"');
    expect(head.files['docs/index.md']).toBe(`${INDEX}\nMais texto.\n`);
    expect(github.openPull(BRANCH)).toMatchObject({ draft: true });
    expect(github.pipelineRuns).toEqual([head.sha]);
    expect(view()).toMatchObject({ unverified: false, pr: { draft: true } });

    await publisher.send();
    expect(view().error).toBeUndefined();
    expect(github.openPull(BRANCH)!.draft).toBe(false);
  });

  it('Salvar e verificar sem nada mudado e sem rascunho: avisa e não cria branch', async () => {
    const { github, publisher, view } = await setup();
    await publisher.saveAndVerify();
    expect(view().error).toBe('Nothing to save: the page has no changes.');
    expect(github.refs.has(BRANCH)).toBe(false);
  });

  it('Descartar: fecha o PR, apaga a branch e a página volta ao texto da principal', async () => {
    const { github, page, publisher, holder, view } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveAndVerify();
    await publisher.discard();
    expect(view().error).toBeUndefined();
    expect(github.refs.has(BRANCH)).toBe(false);
    expect(github.pulls[0].state).toBe('closed');
    expect(holder.session).toMatchObject({ hasBranch: false, content: INDEX });
    expect(view()).toMatchObject({ onDefaultBranch: true, pr: undefined });
  });
});

describe('merge feito no GitHub', () => {
  it('o painel mostra a página como publicada', async () => {
    const { github, page, publisher, view } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveAndVerify();
    await publisher.send();
    Object.assign(github.openPull(BRANCH)!, { state: 'closed', merged: true });
    await publisher.refreshChecks();
    expect(view()).toMatchObject({ pr: undefined, published: { number: 1 } });
  });
});

describe('versão publicada mudou depois do rascunho (4e)', () => {
  const publish = (github: FakeGitHub, text: string) => github.push('main', github.commit('docs: publicado', { ...github.head('main')!.files, 'docs/index.md': text }));

  it('outro trecho: Salvar e verificar traz a versão publicada para o rascunho e segue', async () => {
    const { github, page, publisher, holder, view } = await setup();
    page.edit(`${INDEX}\nMais texto.\n`);
    await publisher.saveDraft();
    publish(github, INDEX.replace('# Início', '# Começo'));
    await publisher.saveAndVerify();
    expect(view()).toMatchObject({ error: undefined, conflict: false, pr: { draft: true } });
    expect(github.head(BRANCH)!.files['docs/index.md']).toBe('# Começo\n\nTexto da página.\n\nMais texto.\n');
    expect(holder.session.content).toBe('# Começo\n\nTexto da página.\n\nMais texto.\n');
  });

  it('mesmo trecho: sem PR e Enviar travado até resolver; resolver grava o merge e libera', async () => {
    let choice: 'mine' | undefined;
    const { github, page, publisher, view } = await setup(() => choice);
    page.edit(INDEX.replace('Texto da página.', 'Meu texto.'));
    await publisher.saveDraft();
    publish(github, INDEX.replace('Texto da página.', 'Texto publicado.'));
    await publisher.saveAndVerify();
    expect(view()).toMatchObject({ conflict: true, unverified: true, pr: undefined });
    expect(view().notice).toContain('resolve the conflict');
    expect(github.pulls).toEqual([]);

    // Cancelar a tela não muda nada
    await publisher.resolveConflict();
    expect(view().conflict).toBe(true);

    choice = 'mine';
    await publisher.resolveConflict();
    expect(view()).toMatchObject({ error: undefined, conflict: false });
    const head = github.head(BRANCH)!;
    expect(head.files['docs/index.md']).toBe('# Início\n\nMeu texto.\n');
    expect(head.parents).toHaveLength(2);

    await publisher.saveAndVerify();
    expect(view()).toMatchObject({ error: undefined, conflict: false, pr: { draft: true } });
  });

  it('ao abrir o painel com o rascunho já em conflito, o painel mostra o conflito', async () => {
    const first = await setup();
    first.page.edit(INDEX.replace('Texto da página.', 'Meu texto.'));
    await first.publisher.saveDraft();
    publish(first.github, INDEX.replace('Texto da página.', 'Texto publicado.'));
    await first.publisher.load();
    expect(first.view().conflict).toBe(true);
  });
});
