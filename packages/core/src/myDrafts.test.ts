import { FakeGitHub } from '../test/fakeGitHub';
import { GitHubClient } from './github';
import { listMyDrafts } from './myDrafts';

const FILES = { 'mkdocs.yml': 'site_name: Wiki\n', 'docs/index.md': '# Início\n', 'docs/deploy.md': '# Deploy\n' };
const client = (github: FakeGitHub) =>
  new GitHubClient({ baseUrl: 'https://api.github.com', fetch: github.fetch, headers: { Authorization: `Bearer ${github.token}` } }, github.slug);
const isPage = (path: string) => path.startsWith('docs/') && path.endsWith('.md');

describe('listMyDrafts', () => {
  it('as branches da pessoa que mudam uma página: rascunho, em revisão; publicada e de outra pessoa ficam de fora', async () => {
    const github = new FakeGitHub(FILES);
    const draft = (branch: string, files: Record<string, string>) =>
      github.push(branch, github.commit('docs', { ...github.head('main')!.files, ...files }, [github.refs.get('main')!]));
    draft('docs/pessoa-teste/docs-deploy', { 'docs/deploy.md': '# Deploy\n\nNovo.\n' });
    draft('docs/pessoa-teste/docs-index', { 'docs/index.md': '# Início\n\nNovo.\n' });
    draft('docs/maria/docs-index', { 'docs/index.md': '# Da Maria\n' });
    draft('docs/pessoa-teste/so-config', { 'mkdocs.yml': 'site_name: Outro\n' });
    github.pulls.push({ number: 1, head: 'docs/pessoa-teste/docs-index', base: 'main', title: 'docs', body: '', draft: false, state: 'open', author: github.login });
    // Publicada: a principal já tem o mesmo que a branch
    draft('docs/pessoa-teste/docs-velha', {});

    const drafts = await listMyDrafts(client(github), { login: github.login, defaultBranch: 'main', isPage });
    expect(drafts).toEqual([
      { branch: 'docs/pessoa-teste/docs-deploy', page: 'docs/deploy.md', state: 'draft', pr: undefined },
      { branch: 'docs/pessoa-teste/docs-index', page: 'docs/index.md', state: 'review', pr: { number: 1, url: 'https://github.com/acme/wiki/pull/1' } },
    ]);
  });
});
