/**
 * Repositórios do GitHub dos cenários: dois repositórios privados na conta do `gh` (a da pessoa que roda os testes),
 * criados na primeira vez. Cada rodada começa do mesmo ponto: o `main` volta à tag `cenario-inicio`, e os pull
 * requests e as branches da rodada anterior somem. O conteúdo inicial vem de fixtures/<pasta>.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const START_TAG = 'cenario-inicio';

const run = (command: string, args: string[], cwd?: string) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gh = (...args: string[]) => run('gh', args);
const git = (cwd: string, ...args: string[]) => run('git', args, cwd);

export const githubLogin = () => gh('api', 'user', '-q', '.login');

/** Token do `gh`, que a extensão usa no lugar do login do VS Code (TECHDOCS_EDITOR_E2E_GITHUB_TOKEN). */
export const githubToken = () => gh('auth', 'token');

export type ScenarioRepo = { slug: string; url: string };

/** O repositório `name` na conta do `gh`, no estado inicial: só o conteúdo de fixtures/`fixture`, sem PRs nem branches. */
export function freshRepo(name: string, fixture: string): ScenarioRepo {
  const slug = `${githubLogin()}/${name}`;
  const url = `https://github.com/${slug}.git`;
  let exists = true;
  try {
    gh('repo', 'view', slug, '--json', 'name');
  } catch {
    exists = false;
  }
  if (!exists) {
    gh('repo', 'create', slug, '--private', '--description', 'Cenários de teste do TechDocs Editor (criado pelos testes)');
    pushInitial(url, fixture);
    return { slug, url };
  }
  // Os PRs abertos da rodada anterior, com as branches
  const open = gh('pr', 'list', '--repo', slug, '--state', 'open', '--json', 'number', '-q', '.[].number').split('\n').filter(Boolean);
  for (const number of open) gh('pr', 'close', number, '--repo', slug, '--delete-branch');
  const work = mkdtempSync(join(tmpdir(), 'cenario-reset-'));
  git(work, 'init', '-q');
  git(work, 'remote', 'add', 'origin', url);
  const tags = git(work, 'ls-remote', '--tags', 'origin', START_TAG);
  if (!tags) {
    pushInitial(url, fixture);
    return { slug, url };
  }
  const branches = git(work, 'ls-remote', '--heads', 'origin')
    .split('\n')
    .map(line => line.split('\t')[1]?.replace('refs/heads/', ''))
    .filter((branch): branch is string => Boolean(branch) && branch !== 'main');
  for (const branch of branches) git(work, 'push', '-q', 'origin', '--delete', branch);
  git(work, 'fetch', '-q', 'origin', `refs/tags/${START_TAG}:refs/tags/${START_TAG}`);
  git(work, 'push', '-q', '--force', 'origin', `${START_TAG}^{commit}:refs/heads/main`);
  return { slug, url };
}

/** Primeiro commit do repositório com o conteúdo da fixture, marcado com a tag do estado inicial. */
function pushInitial(url: string, fixture: string) {
  const work = mkdtempSync(join(tmpdir(), 'cenario-inicio-'));
  cpSync(join(__dirname, 'fixtures', fixture), work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'Estado inicial do cenário');
  git(work, 'tag', '-f', START_TAG);
  git(work, 'remote', 'add', 'origin', url);
  git(work, 'push', '-q', '--force', 'origin', 'main');
  git(work, 'push', '-q', '--force', 'origin', `refs/tags/${START_TAG}`);
}

/** `git clone` numa pasta nova, como a pessoa faria no terminal. Devolve a pasta do clone. */
export function cloneRepo(repo: ScenarioRepo, folder: string): string {
  const parent = mkdtempSync(join(tmpdir(), 'cenario-clone-'));
  run('git', ['clone', '-q', repo.url, folder], parent);
  return join(parent, folder);
}

/** O merge do PR no GitHub, como quem publica faria no site (a extensão não faz merge, X7). */
export function mergePr(repo: ScenarioRepo, number: number) {
  gh('pr', 'merge', String(number), '--repo', repo.slug, '--squash', '--delete-branch');
}

/** PRs abertos do repositório: número, título e branch. */
export function openPrs(repo: ScenarioRepo): { number: number; title: string; headRefName: string; isDraft: boolean }[] {
  return JSON.parse(gh('pr', 'list', '--repo', repo.slug, '--state', 'open', '--json', 'number,title,headRefName,isDraft'));
}

/** Um arquivo do `main` no GitHub (depois do merge). */
export function mainFile(repo: ScenarioRepo, path: string): string | undefined {
  try {
    return gh('api', `repos/${repo.slug}/contents/${path}?ref=main`, '-H', 'Accept: application/vnd.github.raw');
  } catch {
    return undefined;
  }
}
