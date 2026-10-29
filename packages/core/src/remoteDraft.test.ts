import { FakeGitHub } from '../test/fakeGitHub';
import { GitHubClient } from './github';
import { RemoteDraftChangedError, RemoteReadOnlyError, saveRemoteDraft, saveRemoteImage } from './remoteDraft';
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

  it('a página mudou no rascunho depois da leitura: RemoteDraftChangedError, nada gravado', async () => {
    const github = new FakeGitHub(FILES);
    const session = await open(github);
    const { session: saved } = await saveRemoteDraft(client(github), session, '# Deploy\n\nA.\n', { message: 'a' });
    const stale = { ...saved, contentSha: session.contentSha, content: session.content };
    await expect(saveRemoteDraft(client(github), stale, '# Deploy\n\nB.\n', { message: 'b' })).rejects.toBeInstanceOf(RemoteDraftChangedError);
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
