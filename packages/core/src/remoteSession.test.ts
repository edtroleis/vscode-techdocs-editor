import { FakeGitHub } from '../test/fakeGitHub';
import { GitHubClient } from './github';
import {
  findRemotePage,
  findRemoteSites,
  loadRemoteSession,
  loadRemoteSiteTree,
  RemoteDraftFileMissingError,
  RemotePageNotFoundError,
} from './remoteSession';

const FILES = {
  'README.md': '# Wiki\n',
  'mkdocs.yml': 'site_name: Wiki da Acme\nnav:\n  - Início: index.md\n  - Guias:\n      - guias/deploy.md\n',
  'docs/index.md': '# Início\n',
  'docs/guias/deploy.md': '# Como fazer deploy\n\nPasso a passo.\n',
  'docs/guias/rollback.md': '# Rollback\n',
  'docs/assets/logo.png': 'binário',
  'servico/mkdocs.yml': 'site_name: Pagamentos\ndocs_dir: paginas\n',
  'servico/paginas/index.md': '# Pagamentos\n',
  'node_modules/pacote/mkdocs.yml': 'site_name: Não é nosso\n',
  '.markdownlint.yaml': 'MD013: false\n',
  '.techdocs-editor.yaml': 'verification:\n  mode: pipeline\n',
};

/** Cliente do GitHub simulado, com o token do login ou sem nenhum (repositório público). */
const client = (github: FakeGitHub, token: string | undefined = github.token) =>
  new GitHubClient({ baseUrl: 'https://api.github.com', fetch: github.fetch, headers: token ? { Authorization: `Bearer ${token}` } : {} }, github.slug);

describe('findRemoteSites', () => {
  it('cada mkdocs.yml do repositório, com a pasta das docs e o nome; sem node_modules', async () => {
    const sites = await findRemoteSites(client(new FakeGitHub(FILES)), 'main');
    expect(sites.map(({ root, docsDir, name }) => ({ root, docsDir, name }))).toEqual([
      { root: '', docsDir: 'docs', name: 'Wiki da Acme' },
      { root: 'servico', docsDir: 'servico/paginas', name: 'Pagamentos' },
    ]);
  });

  it('ref que não existe: nenhum site', async () => {
    expect(await findRemoteSites(client(new FakeGitHub(FILES)), 'nao-existe')).toEqual([]);
  });
});

describe('loadRemoteSiteTree', () => {
  it('as páginas do docs_dir e o menu pelo nav; as de fora do nav à parte', async () => {
    const github = new FakeGitHub(FILES);
    const [site] = await findRemoteSites(client(github), 'main');
    const tree = await loadRemoteSiteTree(client(github), site, 'main');
    expect(tree.pages).toEqual(['guias/deploy.md', 'guias/rollback.md', 'index.md']);
    expect(tree.tree.nodes).toEqual([
      { kind: 'page', title: 'Início', path: 'index.md' },
      { kind: 'section', title: 'Guias', children: [{ kind: 'page', title: 'Deploy', path: 'guias/deploy.md' }] },
    ]);
    expect(tree.tree.notInNav).toEqual([{ kind: 'page', title: 'Rollback', path: 'guias/rollback.md' }]);
  });

  it('com titles, o título vem do título 1 de cada página', async () => {
    const github = new FakeGitHub(FILES);
    const [site] = await findRemoteSites(client(github), 'main');
    const { tree } = await loadRemoteSiteTree(client(github), site, 'main', { titles: true });
    expect(tree.nodes[1]).toEqual({ kind: 'section', title: 'Guias', children: [{ kind: 'page', title: 'Como fazer deploy', path: 'guias/deploy.md' }] });
  });
});

describe('findRemotePage', () => {
  it('o caminho da URL do site vira o arquivo, como o MkDocs resolve', async () => {
    const github = new FakeGitHub(FILES);
    const [site] = await findRemoteSites(client(github), 'main');
    expect(await findRemotePage(client(github), site, '', 'main')).toBe('docs/index.md');
    expect(await findRemotePage(client(github), site, 'guias/deploy', 'main')).toBe('docs/guias/deploy.md');
    expect(await findRemotePage(client(github), site, 'nada', 'main')).toBeNull();
  });
});

describe('loadRemoteSession', () => {
  const page = { filePath: 'docs/guias/deploy.md', docsDir: 'docs' };

  it('sem rascunho: o texto da main, a branch que o rascunho vai ter e a configuração do repositório', async () => {
    const github = new FakeGitHub(FILES);
    const session = await loadRemoteSession(client(github), page, { login: github.login });
    expect(session).toMatchObject({
      login: 'pessoa-teste',
      branch: 'docs/pessoa-teste/docs-guias-deploy',
      hasBranch: false,
      content: FILES['docs/guias/deploy.md'],
      mainSha: github.refs.get('main'),
      pr: null,
      repo: { defaultBranch: 'main', canWrite: true },
      lintConfig: { MD013: false },
      repoConfig: { verification: { mode: 'pipeline' } },
    });
  });

  it('com rascunho: o texto da branch da pessoa e o PR dela', async () => {
    const github = new FakeGitHub(FILES);
    const branch = 'docs/pessoa-teste/docs-guias-deploy';
    github.push(branch, github.commit('docs: rascunho [skip ci]', { ...FILES, 'docs/guias/deploy.md': '# Como fazer deploy\n\nRascunho.\n' }));
    github.pulls.push({ number: 1, head: branch, base: 'main', title: 'Deploy', body: '', draft: true, state: 'open', author: github.login });
    const session = await loadRemoteSession(client(github), page, { login: github.login });
    expect(session.hasBranch).toBe(true);
    expect(session.content).toBe('# Como fazer deploy\n\nRascunho.\n');
    expect(session.pr?.number).toBe(1);
  });

  it('branchPattern próprio', async () => {
    const github = new FakeGitHub(FILES);
    const session = await loadRemoteSession(client(github), page, { login: github.login, branchPattern: 'rascunho/{login}/{path}' });
    expect(session.branch).toBe('rascunho/pessoa-teste/docs-guias-deploy');
  });

  it('sem permissão de escrita: canWrite false (M8)', async () => {
    const github = new FakeGitHub(FILES);
    github.canWrite = false;
    expect((await loadRemoteSession(client(github), page, { login: github.login })).repo.canWrite).toBe(false);
  });

  it('repositório público sem login: lê da main, sem branch, sem PR e só leitura (A-1)', async () => {
    const github = new FakeGitHub(FILES);
    github.publicRepo = true;
    const session = await loadRemoteSession(client(github, undefined), page);
    expect(session).toMatchObject({ login: undefined, branch: undefined, hasBranch: false, pr: null, content: FILES['docs/guias/deploy.md'] });
    expect(session.repo.canWrite).toBe(false);
    expect(github.calls.some(c => c.includes('/pulls'))).toBe(false);
  });

  it('página que não existe e rascunho sem o arquivo: erros próprios', async () => {
    const github = new FakeGitHub(FILES);
    await expect(loadRemoteSession(client(github), { filePath: 'docs/nada.md', docsDir: 'docs' }, { login: github.login })).rejects.toBeInstanceOf(RemotePageNotFoundError);
    const { 'docs/guias/deploy.md': _, ...without } = FILES;
    github.push('docs/pessoa-teste/docs-guias-deploy', github.commit('docs: apagou', without));
    await expect(loadRemoteSession(client(github), page, { login: github.login })).rejects.toBeInstanceOf(RemoteDraftFileMissingError);
  });
});
