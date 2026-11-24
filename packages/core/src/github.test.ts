import { DEFAULT_API_BASE_URL, GitHubClient, GitHubTransport, graphqlUrl, userTransport } from './github';
import { FakeGitHub } from '../test/fakeGitHub';

describe('GitHubClient', () => {
  it('consulta o GitHub sem cache do navegador (rascunho descartado não pode reaparecer)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: { sha: 'abc' } })));
    const transport: GitHubTransport = { baseUrl: 'https://api.github.com', fetch, headers: {} };
    const client = new GitHubClient(transport, 'dono/wiki');

    await client.getBranchSha('docs/pessoa/docs-index');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/dono/wiki/git/ref/heads/docs/pessoa/docs-index',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });
});

describe('GitHub Enterprise', () => {
  it('GraphQL fica em /api/graphql no Enterprise e em /graphql no github.com', () => {
    expect(graphqlUrl('https://api.github.com')).toBe('https://api.github.com/graphql');
    expect(graphqlUrl('https://ghe.empresa.com/api/v3')).toBe('https://ghe.empresa.com/api/graphql');
  });

  it('o transporte do usuário usa a API da integração', () => {
    expect(userTransport('t').baseUrl).toBe(DEFAULT_API_BASE_URL);
    expect(userTransport('t', 'https://ghe.empresa.com/api/v3/').baseUrl).toBe('https://ghe.empresa.com/api/v3');
  });
});

describe('token do usuário lido da sessão', () => {
  const globalFetch = global.fetch;
  afterEach(() => {
    global.fetch = globalFetch;
  });
  const authOf = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;

  it('num 401, pede um token novo e repete a chamada uma vez', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'abc' } })));
    const source = vi.fn(async ({ renew }: { renew: boolean }) => (renew ? 'novo' : 'velho'));
    const client = new GitHubClient(userTransport(source), 'dono/wiki');

    await expect(client.getBranchSha('main')).resolves.toBe('abc');
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(authOf(calls[0]).Authorization).toBe('Bearer velho');
    expect(authOf(calls[1]).Authorization).toBe('Bearer novo');
    expect(authOf(calls[1]).Accept).toBe('application/vnd.github+json');
  });

  it('sem token diferente, não repete e mostra o erro do GitHub', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }));
    const client = new GitHubClient(userTransport(async () => 'velho'), 'dono/wiki');

    await expect(client.getBranchSha('main')).rejects.toThrow('Bad credentials');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('requisições condicionais (ETag)', () => {
  const pull = { number: 7, node_id: 'n', html_url: 'u', draft: true, state: 'open', merged_at: null, head: { sha: 'abc' } };

  it('repete a consulta com If-None-Match e, no 304, devolve a resposta anterior', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(pull), { headers: { ETag: 'W/"1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetch, headers: {} }, 'dono/wiki');

    const first = await client.getPullRequest(7);
    const second = await client.getPullRequest(7);

    expect(fetch.mock.calls[0][1].headers['If-None-Match']).toBeUndefined();
    expect(fetch.mock.calls[1][1].headers['If-None-Match']).toBe('W/"1"');
    expect(second).toEqual(first);
  });

  it('com mudança, o GitHub responde 200 e o ETag novo vale para a próxima', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(pull), { headers: { ETag: '"1"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...pull, head: { sha: 'def' } }), { headers: { ETag: '"2"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetch, headers: {} }, 'dono/wiki');

    await client.getPullRequest(7);
    expect((await client.getPullRequest(7)).headSha).toBe('def');
    expect((await client.getPullRequest(7)).headSha).toBe('def');
    expect(fetch.mock.calls[2][1].headers['If-None-Match']).toBe('"2"');
  });

  it('escritas não são condicionais', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ sha: 'x' }), { headers: { ETag: '"1"' } }));
    const client = new GitHubClient({ baseUrl: 'https://api.github.com', fetch, headers: {} }, 'dono/wiki');

    await client.createCommit('m', 'tree', ['p']);
    await client.createCommit('m', 'tree', ['p']);

    expect((fetch.mock.calls[1] as any)[1].headers['If-None-Match']).toBeUndefined();
  });
});

describe('pipelines de qualquer CI', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const clientWith = (routes: Record<string, unknown>) => {
    const fetch = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (!(path in routes)) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      return json(routes[path]);
    });
    return new GitHubClient({ baseUrl: 'https://api.github.com', fetch: fetch as any, headers: {} }, 'dono/wiki');
  };

  it('commit statuses (ex.: Jenkins) viram verificações, junto com os checks', async () => {
    const client = clientWith({
      '/repos/dono/wiki/commits/abc/check-runs': {
        check_runs: [{ id: 1, name: 'Links', status: 'completed', conclusion: 'success', html_url: 'u1' }],
      },
      '/repos/dono/wiki/commits/abc/status': {
        statuses: [
          { id: 10, context: 'continuous-integration/jenkins/pr-merge', state: 'failure', target_url: 'https://ci/1' },
          { id: 11, context: 'ci/circleci: build', state: 'pending', target_url: null },
          { id: 12, context: 'Links', state: 'success', target_url: 'u' },
        ],
      },
    });

    expect(await client.getVerifications('abc')).toEqual([
      { id: 1, name: 'Links', status: 'completed', conclusion: 'success', htmlUrl: 'u1' },
      {
        id: 10,
        name: 'continuous-integration/jenkins/pr-merge',
        status: 'completed',
        conclusion: 'failure',
        htmlUrl: 'https://ci/1',
        source: 'status',
      },
      { id: 11, name: 'ci/circleci: build', status: 'in_progress', conclusion: null, htmlUrl: '', source: 'status' },
    ]);
  });

  it('checks obrigatórios da proteção de branch clássica entram junto com os dos rulesets', async () => {
    const client = clientWith({
      '/repos/dono/wiki/rules/branches/main': [
        { type: 'pull_request', parameters: { required_approving_review_count: 1 } },
        { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Links' }] } },
      ],
      '/repos/dono/wiki/branches/main': {
        name: 'main',
        protected: true,
        protection: { required_status_checks: { contexts: ['jenkins', 'Links'], checks: [{ context: 'jenkins' }] } },
      },
    });

    expect(await client.getBranchRules('main')).toEqual({
      requiresPullRequest: true,
      requiredApprovals: 1,
      requiredChecks: ['Links', 'jenkins'],
    });
  });

  it('sem conseguir ler a branch, valem só os rulesets', async () => {
    const client = clientWith({ '/repos/dono/wiki/rules/branches/main': [] });

    expect(await client.getBranchRules('main')).toEqual({ requiresPullRequest: false, requiredApprovals: 0, requiredChecks: [] });
  });
});

describe('envio do repositório inteiro (spec 09)', () => {
  const setup = () => {
    const github = new FakeGitHub({ 'docs/index.md': '# Início\n' });
    const client = new GitHubClient({ ...userTransport(github.token), fetch: github.fetch }, github.slug);
    return { github, client };
  };

  it('cria o repositório privado na conta ou na organização', async () => {
    const { github, client } = setup();
    const mine = await client.createRepository({ owner: github.login, org: false, name: 'guia-x', private: true });
    expect(mine).toEqual({ slug: `${github.login}/guia-x`, cloneUrl: `https://github.com/${github.login}/guia-x.git`, defaultBranch: 'main' });
    await client.createRepository({ owner: 'acme', org: true, name: 'guia-y', private: true });
    expect(github.createdRepos).toEqual([
      { path: '/user/repos', name: 'guia-x', private: true, auto_init: false },
      { path: '/orgs/acme/repos', name: 'guia-y', private: true, auto_init: false },
    ]);
  });

  it('a identidade traz o nome, os e-mails e o e-mail privado do GitHub', async () => {
    const { github, client } = setup();
    github.userId = 123;
    github.login = 'msilva';
    github.userName = 'Maria Silva';
    github.emails = [{ email: 'maria@acme.com', primary: true }];
    expect(await client.getIdentity()).toEqual({
      login: 'msilva',
      name: 'Maria Silva',
      emails: [{ email: 'maria@acme.com', primary: true }],
      noreply: '123+msilva@users.noreply.github.com',
    });
  });

  it('donos possíveis: a conta e as organizações', async () => {
    const { github, client } = setup();
    github.orgs = ['acme'];
    expect(await client.listRepoOwners()).toEqual([
      { login: github.login, org: false },
      { login: 'acme', org: true },
    ]);
  });

  it('o estado da revisão vale pelo último parecer de cada revisor', async () => {
    const { github, client } = setup();
    github.push('docs/x', github.commit('docs: x', { 'docs/index.md': '# Novo\n' }));
    const pr = await client.createPullRequest({ branch: 'docs/x', base: 'main', title: 't', body: '', draft: false });
    expect(await client.getReviewState(pr.number)).toEqual({ state: 'waiting' });
    github.review(pr.number, 'ana', 'CHANGES_REQUESTED');
    expect(await client.getReviewState(pr.number)).toEqual({ state: 'changesRequested', by: 'ana' });
    github.review(pr.number, 'ana', 'APPROVED');
    expect(await client.getReviewState(pr.number)).toEqual({ state: 'approved', by: 'ana' });
  });
});
