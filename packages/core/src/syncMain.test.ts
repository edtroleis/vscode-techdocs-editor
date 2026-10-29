import { FakeGitHub } from '../test/fakeGitHub';
import { GitHubClient } from './github';
import { resolveChunks } from './merge3';
import { commitResolution, syncWithMain } from './syncMain';

const PAGE = 'docs/deploy.md';
const BRANCH = 'docs/pessoa-teste/docs-deploy';
const FILES = { 'mkdocs.yml': 'site_name: Wiki\n', [PAGE]: '# Deploy\n\nA.\n\nB.\n', 'docs/index.md': '# Início\n' };
const target = { branch: BRANCH, base: 'main', filePath: PAGE };

const client = (github: FakeGitHub) =>
  new GitHubClient({ baseUrl: 'https://api.github.com', fetch: github.fetch, headers: { Authorization: `Bearer ${github.token}` } }, github.slug);

/** Rascunho com `draft` na página, e depois `main` publicado com os arquivos trocados. */
function setup(draft: string, main: Record<string, string>) {
  const github = new FakeGitHub(FILES);
  github.push(BRANCH, github.commit('docs: rascunho [skip ci]', { ...FILES, [PAGE]: draft }, [github.refs.get('main')!]));
  github.push('main', github.commit('docs: publicado', { ...FILES, ...main }));
  return github;
}

describe('syncWithMain', () => {
  it('nada publicado depois do rascunho: em dia', async () => {
    const github = new FakeGitHub(FILES);
    github.push(BRANCH, github.commit('rascunho', { ...FILES, [PAGE]: '# Deploy\n' }, [github.refs.get('main')!]));
    expect(await syncWithMain(client(github), target)).toEqual({ kind: 'up-to-date' });
  });

  it('outra página publicada: o merge do GitHub traz para o rascunho, sem mexer na página', async () => {
    const github = setup('# Deploy\n\nA mudado.\n\nB.\n', { 'docs/index.md': '# Novo início\n' });
    const synced = await syncWithMain(client(github), target);
    expect(synced).toMatchObject({ kind: 'updated', pageChanged: false });
    const head = github.head(BRANCH)!;
    expect(head.files['docs/index.md']).toBe('# Novo início\n');
    expect(head.files[PAGE]).toBe('# Deploy\n\nA mudado.\n\nB.\n');
    // Mantém o [skip ci] do rascunho ainda não verificado
    expect(head.message).toContain('[skip ci]');
  });

  it('a mesma página publicada: conflito com os trechos, e a resolução vira um commit de merge', async () => {
    const github = setup('# Deploy\n\nA meu.\n\nB.\n', { [PAGE]: '# Deploy\n\nA deles.\n\nB.\n' });
    const synced = await syncWithMain(client(github), target);
    if (synced.kind !== 'conflict') throw new Error(synced.kind);
    const text = resolveChunks(synced.conflict.chunks, ['mine']);
    expect(text).toBe('# Deploy\n\nA meu.\n\nB.\n');

    const { commitSha } = await commitResolution(client(github), target, synced.conflict, text, 'docs: junta a versão publicada');
    const head = github.head(BRANCH)!;
    expect(head.sha).toBe(commitSha);
    expect(head.parents).toEqual([synced.conflict.branchHead, synced.conflict.mainHead]);
    expect(await syncWithMain(client(github), target)).toEqual({ kind: 'up-to-date' });
  });
});
