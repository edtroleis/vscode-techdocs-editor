import { createHash } from 'node:crypto';

/**
 * GitHub simulado para os testes da publicação, como uma função `fetch` (sem servidor HTTP): branches,
 * PRs, pipeline, rulesets e login. Versão enxuta do `e2e/portal/fake-github.ts` do plugin: os commits
 * chegam prontos (`push`), como os de um `git push`, em vez de pela API de conteúdo.
 *
 * A pipeline segue as regras do GitHub Actions: roda ao abrir o PR e a cada push numa branch com PR
 * aberto, e não roda se a mensagem do commit tiver "[skip ci]".
 */

export const CHECK_NAMES = ['Formatação do texto', 'Links', 'Dados sensíveis', 'Montagem da documentação'];
/** O que um CI de fora do GitHub Actions (Jenkins) reporta como commit status. */
export const EXTERNAL_CHECK_NAMES = ['continuous-integration/jenkins/pr-merge'];

export type FakeCommit = { sha: string; message: string; files: Record<string, string> };
export type FakePull = {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: 'open' | 'closed';
  author: string;
};
type CheckResult = { conclusion: 'success' | 'failure'; annotations?: Array<{ path: string; line: number; message: string }> };
/** Resultado de cada check para uma execução (padrão: todos passam). */
export type PipelineOutcome = Record<string, CheckResult>;

const sha1 = (text: string) => createHash('sha1').update(text).digest('hex');

export class FakeGitHub {
  readonly slug: string;
  login = 'pessoa-teste';
  readonly refs = new Map<string, string>();
  readonly commits = new Map<string, FakeCommit>();
  readonly pulls: FakePull[] = [];
  /** SHAs em que a pipeline rodou, na ordem. */
  readonly pipelineRuns: string[] = [];
  /** Chamadas recebidas ("MÉTODO caminho"), para conferir o que o editor fez. */
  readonly calls: string[] = [];
  /** Chamadas respondidas com 304 (If-None-Match igual ao ETag). */
  readonly notModified: string[] = [];
  requiredApprovals = 0;
  /** O repositório tem pipeline. Sem ela, nenhum check roda. */
  hasPipeline = true;
  pipelineKind: 'actions' | 'external' = 'actions';
  canWrite = true;
  isAdmin = false;
  /** Resultado da próxima execução da pipeline (depois volta ao padrão). */
  nextOutcome: PipelineOutcome | undefined;
  /** A pipeline leva esta quantidade de consultas aos checks para registrar as verificações de um commit. */
  pipelineStartDelay = 0;
  /** Depois de um push, o PR continua apontando para o commit anterior por esta quantidade de consultas. */
  prHeadLag = 0;
  /** Token que o login entrega agora (muda com `rotateToken`). */
  token = 'token-falso';
  /** Token de um login com o escopo `workflow`: só com ele o GitHub aceita mudar `.github/workflows/`. */
  readonly workflowToken = 'token-falso-workflow';
  /** Rulesets criados pela API (setup). */
  readonly rulesets: Array<{ id: number; name: string; rules: any[] }> = [];
  /** Repositório público: leitura sem login (os templates centrais tentam primeiro assim). */
  publicRepo = false;
  /** Blobs pelo SHA (`git/blobs`), preenchidos ao listar uma árvore. */
  private readonly blobs = new Map<string, string>();
  /** Árvores criadas pela API (`git/trees`), pelo SHA. */
  private readonly trees = new Map<string, Record<string, string>>();
  private auth = '';
  private readonly revoked = new Set<string>();
  private readonly outcomes = new Map<string, PipelineOutcome>();
  private readonly pendingStart = new Map<string, number>();
  private readonly staleHead = new Map<string, { sha: string; remaining: number }>();
  private failures: Array<{ method: string; path: RegExp; status: number; message: string }> = [];
  private counter = 0;

  constructor(files: Record<string, string>, slug = 'acme/wiki') {
    this.slug = slug;
    this.push('main', this.commit('docs: wiki inicial', files));
  }

  // ------------------------------------------------------------ estado (para os testes)

  /** Um commit novo (ainda sem branch). */
  commit(message: string, files: Record<string, string>): FakeCommit {
    const commit = { sha: sha1(`${message}${JSON.stringify(files)}${this.counter++}`), message, files };
    this.commits.set(commit.sha, commit);
    return commit;
  }

  /** `git push`: a branch passa a apontar para o commit; com PR aberto, a pipeline roda. */
  push(branch: string, commit: FakeCommit) {
    this.commits.set(commit.sha, commit);
    const previous = this.refs.get(branch);
    if (previous && this.prHeadLag) this.staleHead.set(branch, { sha: previous, remaining: this.prHeadLag });
    this.refs.set(branch, commit.sha);
    if (this.openPull(branch)) this.runPipeline(commit.sha);
  }

  head(branch: string): FakeCommit | undefined {
    const sha = this.refs.get(branch);
    return sha ? this.commits.get(sha) : undefined;
  }

  openPull(branch?: string): FakePull | undefined {
    return this.pulls.find(p => p.state === 'open' && (branch === undefined || p.head === branch));
  }

  /** O GitHub troca o token da pessoa: o antigo passa a dar 401. */
  rotateToken() {
    this.revoked.add(this.token);
    this.token = `${this.token}-novo`;
  }

  /** A próxima chamada `method` cujo caminho casa com `path` falha com `status`. */
  failNext(method: string, path: RegExp, status: number, message: string) {
    this.failures.push({ method, path, status, message });
  }

  private runPipeline(sha: string) {
    if (!this.hasPipeline || this.commits.get(sha)!.message.includes('[skip ci]')) return;
    this.pipelineRuns.push(sha);
    if (this.pipelineStartDelay) this.pendingStart.set(sha, this.pipelineStartDelay);
    this.outcomes.set(sha, this.nextOutcome ?? {});
    this.nextOutcome = undefined;
  }

  private get checkNames() {
    return this.pipelineKind === 'external' ? EXTERNAL_CHECK_NAMES : CHECK_NAMES;
  }

  private checkId = (sha: string, index: number) => parseInt(sha.slice(0, 6), 16) * 10 + index;

  private results(sha: string, polling: boolean) {
    const outcome = this.outcomes.get(sha);
    if (!outcome) return [];
    const wait = this.pendingStart.get(sha);
    if (polling && wait) {
      this.pendingStart.set(sha, wait - 1);
      return [];
    }
    return this.checkNames.map((name, i) => ({
      id: this.checkId(sha, i),
      name,
      status: 'completed',
      conclusion: outcome[name]?.conclusion ?? 'success',
      html_url: `https://github.com/${this.slug}/runs/${i}`,
    }));
  }

  private annotations(id: number) {
    for (const [sha, outcome] of this.outcomes) {
      const index = CHECK_NAMES.findIndex((_, i) => this.checkId(sha, i) === id);
      if (index >= 0) {
        return (outcome[CHECK_NAMES[index]]?.annotations ?? []).map(a => ({
          path: a.path,
          start_line: a.line,
          annotation_level: 'failure',
          message: a.message,
        }));
      }
    }
    return [];
  }

  private pullJson(pr: FakePull, polling: boolean) {
    let headSha = this.refs.get(pr.head) ?? '';
    const stale = this.staleHead.get(pr.head);
    if (polling && stale?.remaining) {
      stale.remaining--;
      headSha = stale.sha;
    }
    return {
      number: pr.number,
      node_id: `PR_${pr.number}`,
      html_url: `https://github.com/${this.slug}/pull/${pr.number}`,
      draft: pr.draft,
      state: pr.state,
      merged_at: null,
      head: { ref: pr.head, sha: headSha },
      title: pr.title,
      user: { login: pr.author },
    };
  }

  // ------------------------------------------------------------ API

  /** Responde uma chamada; `undefined` = rota desconhecida (501). */
  private handle(method: string, url: URL, body: any): { status: number; json?: unknown } | undefined {
    const path = decodeURIComponent(url.pathname);
    const repo = `/repos/${this.slug}`;
    const ok = (json: unknown, status = 200) => ({ status, json });
    const notFound = { status: 404, json: { message: 'Not Found' } };

    if (method === 'GET' && path === '/user') return ok({ login: this.login });
    if (method === 'POST' && path === '/graphql') {
      const pr = this.pulls.find(p => `PR_${p.number}` === body.variables?.id);
      if (!pr) return ok({ errors: [{ message: 'Could not resolve to a node' }] });
      pr.draft = false;
      return ok({ data: { markPullRequestReadyForReview: { clientMutationId: null } } });
    }
    if (!path.startsWith(repo)) return undefined;
    const rest = path.slice(repo.length);

    if (method === 'GET' && rest === '') {
      return ok({ default_branch: 'main', permissions: { push: this.canWrite, admin: this.isAdmin }, html_url: `https://github.com/${this.slug}` });
    }
    if (method === 'PATCH' && rest === '') {
      if (!this.isAdmin) return { status: 403, json: { message: 'Must have admin rights to Repository.' } };
      return ok({});
    }
    if (rest === '/rulesets' || rest.startsWith('/rulesets/')) {
      if (!this.isAdmin) return { status: 403, json: { message: 'Must have admin rights to Repository.' } };
      if (method === 'GET' && rest === '/rulesets') return ok(this.rulesets.map(({ id, name }) => ({ id, name })));
      if (method === 'POST') {
        this.rulesets.push({ id: this.rulesets.length + 1, name: body.name, rules: body.rules });
        return ok({ id: this.rulesets.length }, 201);
      }
      const existing = this.rulesets.find(r => `/rulesets/${r.id}` === rest);
      if (method === 'PUT' && existing) {
        existing.rules = body.rules;
        return ok({ id: existing.id });
      }
    }
    if (method === 'GET' && rest.startsWith('/rules/branches/') && this.rulesets.length) {
      return ok(this.rulesets.flatMap(r => r.rules));
    }
    if (method === 'GET' && rest.startsWith('/rules/branches/')) {
      const rules: unknown[] = [{ type: 'pull_request', parameters: { required_approving_review_count: this.requiredApprovals } }];
      if (this.hasPipeline && this.pipelineKind === 'actions') {
        rules.push({ type: 'required_status_checks', parameters: { required_status_checks: CHECK_NAMES.map(context => ({ context })) } });
      }
      return ok(rules);
    }
    if (method === 'GET' && rest.startsWith('/branches/')) return ok({ name: rest.slice(10), protected: false });
    if (method === 'GET' && rest === '/actions/workflows') {
      return ok({ total_count: this.hasPipeline && this.pipelineKind === 'actions' ? 1 : 0, workflows: [] });
    }

    let m = rest.match(/^\/contents\/(.+)$/);
    if (m && method === 'GET') {
      const ref = url.searchParams.get('ref') ?? 'main';
      const content = (this.head(ref) ?? this.commits.get(ref))?.files[m[1]];
      if (content === undefined) return notFound;
      return ok({ content: Buffer.from(content).toString('base64'), sha: sha1(content) });
    }
    m = rest.match(/^\/commits\/([^/]+)$/);
    if (m && method === 'GET') {
      const commit = this.head(decodeURIComponent(m[1])) ?? this.commits.get(m[1]);
      if (!commit) return notFound;
      const tree = sha1(JSON.stringify(commit.files));
      this.trees.set(tree, commit.files);
      return ok({ sha: commit.sha, commit: { message: commit.message, tree: { sha: tree } } });
    }
    m = rest.match(/^\/git\/trees\/(\w+)$/);
    if (m && method === 'GET') {
      const files = this.trees.get(m[1]);
      if (!files) return notFound;
      const entries = Object.entries(files).map(([path, content]) => {
        this.blobs.set(sha1(content), content);
        return { path, type: 'blob', sha: sha1(content), size: Buffer.byteLength(content) };
      });
      return ok({ sha: m[1], tree: entries, truncated: false });
    }
    m = rest.match(/^\/git\/blobs\/(\w+)$/);
    if (m && method === 'GET') {
      const content = this.blobs.get(m[1]);
      return content === undefined ? notFound : ok({ sha: m[1], content: Buffer.from(content).toString('base64'), encoding: 'base64' });
    }
    m = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (m && method === 'GET') {
      const sha = this.refs.get(m[1]);
      return sha ? ok({ object: { sha } }) : notFound;
    }
    m = rest.match(/^\/git\/commits\/(\w+)$/);
    if (m && method === 'GET') {
      const commit = this.commits.get(m[1]);
      if (!commit) return notFound;
      const tree = sha1(JSON.stringify(commit.files));
      this.trees.set(tree, commit.files);
      return ok({ sha: commit.sha, message: commit.message, tree: { sha: tree } });
    }
    if (method === 'POST' && rest === '/git/trees') {
      const files = { ...(this.trees.get(body.base_tree) ?? {}) };
      for (const entry of body.tree) {
        if (entry.content !== undefined) files[entry.path] = entry.content;
        else if (entry.sha === null) delete files[entry.path];
      }
      const tree = sha1(JSON.stringify(files));
      this.trees.set(tree, files);
      return ok({ sha: tree }, 201);
    }
    if (method === 'POST' && rest === '/git/commits') {
      const files = this.trees.get(body.tree);
      if (!files) return { status: 422, json: { message: 'Tree not found' } };
      return ok({ sha: this.commit(body.message, files).sha }, 201);
    }
    if ((method === 'POST' && rest === '/git/refs') || (method === 'PATCH' && rest.startsWith('/git/refs/heads/'))) {
      const commit = this.commits.get(body.sha);
      if (!commit) return { status: 422, json: { message: 'Object does not exist' } };
      // Como o GitHub: mudar um workflow exige o escopo `workflow` do OAuth
      const main = this.head('main')!.files;
      const workflow = Object.keys(commit.files).find(f => f.startsWith('.github/workflows/') && commit.files[f] !== main[f]);
      if (workflow && this.auth !== `Bearer ${this.workflowToken}`) {
        return { status: 404, json: { message: `refusing to allow an OAuth App to create or update workflow \`${workflow}\` without \`workflow\` scope` } };
      }
      const branch = method === 'POST' ? body.ref.replace('refs/heads/', '') : decodeURIComponent(rest.slice('/git/refs/heads/'.length));
      if (method === 'POST' && this.refs.has(branch)) return { status: 422, json: { message: 'Reference already exists' } };
      this.push(branch, commit);
      return ok({ object: { sha: commit.sha } }, method === 'POST' ? 201 : 200);
    }
    m = rest.match(/^\/git\/refs\/heads\/(.+)$/);
    if (m && method === 'DELETE') {
      if (!this.refs.delete(m[1])) return { status: 422, json: { message: 'Reference does not exist' } };
      return { status: 204 };
    }
    if (method === 'GET' && rest === '/pulls') {
      const head = url.searchParams.get('head')?.split(':')[1];
      return ok(this.pulls.filter(p => p.state === 'open' && (!head || p.head === head)).map(p => this.pullJson(p, false)));
    }
    if (method === 'POST' && rest === '/pulls') {
      if (!this.refs.has(body.head)) return { status: 422, json: { message: 'Validation Failed' } };
      if (this.openPull(body.head)) return { status: 422, json: { message: 'A pull request already exists' } };
      const pr: FakePull = {
        number: this.pulls.length + 1,
        head: body.head,
        base: body.base,
        title: body.title,
        body: body.body,
        draft: Boolean(body.draft),
        state: 'open',
        author: this.login,
      };
      this.pulls.push(pr);
      this.runPipeline(this.refs.get(pr.head)!);
      return ok(this.pullJson(pr, false), 201);
    }
    m = rest.match(/^\/pulls\/(\d+)$/);
    if (m) {
      const pr = this.pulls.find(p => p.number === Number(m![1]));
      if (!pr) return notFound;
      if (method === 'GET') return ok(this.pullJson(pr, true));
      if (method === 'PATCH') {
        if (body.state) pr.state = body.state;
        return ok(this.pullJson(pr, false));
      }
    }
    m = rest.match(/^\/commits\/(\w+)\/check-runs$/);
    if (m && method === 'GET') {
      return ok({ check_runs: this.pipelineKind === 'actions' ? this.results(m[1], true) : [] });
    }
    m = rest.match(/^\/commits\/(\w+)\/status$/);
    if (m && method === 'GET') {
      const statuses =
        this.pipelineKind === 'external'
          ? this.results(m[1], true).map(r => ({ id: r.id, context: r.name, state: r.conclusion, target_url: `https://jenkins.example.com/job/${r.id}` }))
          : [];
      return ok({ statuses });
    }
    m = rest.match(/^\/check-runs\/(\d+)\/annotations$/);
    if (m && method === 'GET') return ok(this.annotations(Number(m[1])));
    return undefined;
  }

  /** O `fetch` que o cliente do GitHub usa nos testes. */
  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    this.calls.push(`${method} ${url.pathname}${url.search}`);
    const auth = headers.Authorization ?? '';
    this.auth = auth;
    const anonymousRead = this.publicRepo && !auth && method === 'GET';
    if (!anonymousRead && ((auth !== `Bearer ${this.token}` && auth !== `Bearer ${this.workflowToken}`) || this.revoked.has(auth.slice(7)))) {
      return Response.json({ message: 'Bad credentials' }, { status: 401 });
    }
    const failure = this.failures.findIndex(f => f.method === method && f.path.test(url.pathname));
    if (failure >= 0) {
      const [f] = this.failures.splice(failure, 1);
      return Response.json({ message: f.message }, { status: f.status });
    }
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const reply = this.handle(method, url, body);
    if (!reply) return Response.json({ message: `Não simulado: ${method} ${url.pathname}` }, { status: 501 });
    if (reply.status === 204) return new Response(null, { status: 204 });
    if (method === 'GET' && reply.status === 200) {
      const etag = `"${sha1(JSON.stringify(reply.json))}"`;
      if (headers['If-None-Match'] === etag) {
        this.notModified.push(`${method} ${url.pathname}`);
        return new Response(null, { status: 304, headers: { etag } });
      }
      return Response.json(reply.json, { status: 200, headers: { etag } });
    }
    return Response.json(reply.json, { status: reply.status });
  };
}
