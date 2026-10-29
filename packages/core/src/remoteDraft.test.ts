import { FakeGitHub } from '../test/fakeGitHub';
import { GitHubClient } from './github';
import { createRemotePage, RemoteDraftChangedError, RemotePageExistsError, RemoteReadOnlyError, saveRemoteDraft, saveRemoteImage } from './remoteDraft';
import { loadRemoteSession } from './remoteSession';

const FILES = {
  'mkdocs.yml': 'site_name: Wiki\n',
  'docs/index.md': '# Início\n',
  'docs/guias/deploy.md': '# Deploy\n',
};

const client = (github: FakeGitHub) =>
  new GitHubClient({ baseUrl: 'https://api.github.com', fetch: github.fetch, headers: { Authorization: `Bearer ${github.token}` } }, github.slug);

const open = (github: FakeGitHub, filePath = 'docs/guias/deploy.md') => loadRemoteSession(client(github), { filePath, docsDir: 'docs' }, { login: github.login });

describe('saveRemoteDraft', () => {
  it('primeiro salvar: cria a branch do rascunho a partir da principal lida e faz o commit com [skip ci]', async () => {
    const github = new FakeGitHub(FILES);
    const session = await open(github);
    const main = github.refs.get('main');
    // Alguém publica outra página depois da leitura: o rascunho nasce do commit lido, não do novo
    github.push('main', github.commit('outra', { ...FILES, 'docs/index.md': '# Novo início\n' }));

    const { session: saved, commitSha } = await saveRemoteDraft(client(github), session, '# Deploy\n\nPasso a passo.\n', { message: 'docs: rascunho de "Deploy"' });
    const head = github.head('docs/pessoa-teste/docs-guias-deploy')!;
    expect(head.sha).toBe(commitSha);
    expect(head.message).toBe('docs: rascunho de "Deploy" [skip ci]');
    expect(head.files['docs/guias/deploy.md']).toBe('# Deploy\n\nPasso a passo.\n');
    expect(head.files['docs/index.md']).toBe('# Início\n');
    expect(github.calls).toContain('POST /repos/acme/wiki/git/refs');
    expect(main).not.toBe(github.refs.get('main'));
    expect(saved).toMatchObject({ hasBranch: true, content: '# Deploy\n\nPasso a passo.\n' });

    // Segundo salvar: sobre o SHA do primeiro, sem criar a branch de novo
    github.calls.length = 0;
    await saveRemoteDraft(client(github), saved, '# Deploy\n\nOutro texto.\n', { message: 'docs: rascunho de "Deploy"' });
    expect(github.calls.filter(c => c.startsWith('POST'))).toEqual([]);
    expect(github.head('docs/pessoa-teste/docs-guias-deploy')!.files['docs/guias/deploy.md']).toBe('# Deploy\n\nOutro texto.\n');
  });

  it('texto igual ao lido: nenhum commit e nenhuma branch', async () => {
    const github = new FakeGitHub(FILES);
    const session = await open(github);
    expect(await saveRemoteDraft(client(github), session, session.content, { message: 'x' })).toEqual({ session });
    expect(github.refs.has('docs/pessoa-teste/docs-guias-deploy')).toBe(false);
  });

  it('sem pipeline ou com skipCi desligado: sem [skip ci]', async () => {
    const github = new FakeGitHub(FILES);
    github.hasPipeline = false;
    await saveRemoteDraft(client(github), await open(github), '# Deploy\n\nA.\n', { message: 'docs: rascunho' });
    expect(github.head('docs/pessoa-teste/docs-guias-deploy')!.message).toBe('docs: rascunho');
    const other = new FakeGitHub(FILES);
    await saveRemoteDraft(client(other), await open(other), '# Deploy\n\nA.\n', { message: 'docs: rascunho', skipCi: false });
    expect(other.head('docs/pessoa-teste/docs-guias-deploy')!.message).toBe('docs: rascunho');
  });

  it('a página mudou no rascunho depois da leitura, em outro trecho: junta sozinho (M5)', async () => {
    const github = new FakeGitHub({ ...FILES, 'docs/guias/deploy.md': '# Deploy\n\nUm.\n\nDois.\n\nTrês.\n' });
    const session = await open(github);
    // Outra janela salvou antes, mudando o fim
    const { session: other } = await saveRemoteDraft(client(github), session, '# Deploy\n\nUm.\n\nDois.\n\nTrês, de outra janela.\n', { message: 'a' });
    expect(other.hasBranch).toBe(true);
    // Esta janela ainda tem a leitura antiga e muda o começo
    const saved = await saveRemoteDraft(client(github), { ...session, hasBranch: true }, '# Deploy\n\nUm, desta janela.\n\nDois.\n\nTrês.\n', { message: 'b' });
    expect(saved.merged).toBe(true);
    const merged = '# Deploy\n\nUm, desta janela.\n\nDois.\n\nTrês, de outra janela.\n';
    expect(saved.session.content).toBe(merged);
    expect(github.head('docs/pessoa-teste/docs-guias-deploy')!.files['docs/guias/deploy.md']).toBe(merged);
  });

  it('no mesmo trecho: RemoteDraftChangedError com os trechos e a versão de agora; nada gravado', async () => {
    const github = new FakeGitHub(FILES);
    const session = await open(github);
    const { session: saved } = await saveRemoteDraft(client(github), session, '# Deploy\n\nA.\n', { message: 'a' });
    const error = await saveRemoteDraft(client(github), { ...session, hasBranch: true }, '# Deploy\n\nB.\n', { message: 'b' }).catch(e => e);
    expect(error).toBeInstanceOf(RemoteDraftChangedError);
    const conflicts = error.chunks.filter((c: { kind: string }) => c.kind === 'conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].mine.join('\n')).toContain('B.');
    expect(conflicts[0].theirs.join('\n')).toContain('A.');
    expect(error.latest).toMatchObject({ content: '# Deploy\n\nA.\n', contentSha: saved.contentSha });
    expect(github.head('docs/pessoa-teste/docs-guias-deploy')!.files['docs/guias/deploy.md']).toBe('# Deploy\n\nA.\n');
  });

  it('sem login ou sem permissão de escrita: RemoteReadOnlyError', async () => {
    const github = new FakeGitHub(FILES);
    const session = await open(github);
    await expect(saveRemoteDraft(client(github), { ...session, branch: undefined }, 'x', { message: 'x' })).rejects.toBeInstanceOf(RemoteReadOnlyError);
    await expect(saveRemoteDraft(client(github), { ...session, repo: { ...session.repo, canWrite: false } }, 'x', { message: 'x' })).rejects.toBeInstanceOf(RemoteReadOnlyError);
  });
});

describe('saveRemoteImage', () => {
  it('commit da imagem na branch do rascunho (criada se preciso); legível pelo getRaw da branch', async () => {
    const github = new FakeGitHub(FILES);
    const session = await open(github);
    const saved = await saveRemoteImage(client(github), session, 'docs/assets/1-logo.png', Buffer.from('PNG-falso').toString('base64'), { message: 'docs: imagem' });
    expect(saved.hasBranch).toBe(true);
    const head = github.head('docs/pessoa-teste/docs-guias-deploy')!;
    expect(head.message).toBe('docs: imagem [skip ci]');
    const raw = await client(github).getRaw('docs/assets/1-logo.png', 'docs/pessoa-teste/docs-guias-deploy');
    expect(await raw!.text()).toBe('PNG-falso');
    expect(await client(github).getRaw('docs/assets/1-logo.png', 'main')).toBeNull();
  });
});

describe('createRemotePage', () => {
  const BRANCH = 'docs/pessoa-teste/docs-guias-novo';
  const params = (github: FakeGitHub, extra: Partial<Parameters<typeof createRemotePage>[1]> = {}) => ({
    branch: BRANCH,
    mainSha: github.refs.get('main')!,
    filePath: 'docs/guias/novo.md',
    files: { 'docs/guias/novo.md': '# Novo\n', 'mkdocs.yml': 'site_name: Wiki\nnav:\n  - novo: guias/novo.md\n' },
    message: 'docs: nova página "Novo"',
    skipCi: true,
    ...extra,
  });

  it('um commit na branch da página nova, com a página e o mkdocs.yml; a principal não muda', async () => {
    const github = new FakeGitHub(FILES);
    const sha = await createRemotePage(client(github), params(github));
    const head = github.head(BRANCH)!;
    expect(head.sha).toBe(sha);
    expect(head.message).toBe('docs: nova página "Novo" [skip ci]');
    expect(head.files['docs/guias/novo.md']).toBe('# Novo\n');
    expect(head.files['mkdocs.yml']).toContain('guias/novo.md');
    expect(head.files['docs/index.md']).toBe(FILES['docs/index.md']);
    expect(github.head('main')!.files['docs/guias/novo.md']).toBeUndefined();
  });

  it('nunca sobrescreve: a página já existe na principal ou no rascunho', async () => {
    const github = new FakeGitHub(FILES);
    await expect(createRemotePage(client(github), params(github, { filePath: 'docs/index.md' }))).rejects.toBeInstanceOf(RemotePageExistsError);
    await createRemotePage(client(github), params(github));
    await expect(createRemotePage(client(github), params(github))).rejects.toBeInstanceOf(RemotePageExistsError);
  });
});
