import { DEFAULT_API_BASE_URL } from './github';

/** Padrão do nome da branch do rascunho: uma por pessoa e por arquivo. */
export const DEFAULT_BRANCH_PATTERN = 'docs/{login}/{path}';

/**
 * Branch do rascunho de cada pessoa para cada arquivo. No padrão, `{login}` é o login do GitHub e
 * `{path}` o caminho do arquivo sem `.md`, com o que não é letra, número, `.`, `_` ou `-` virando `-`.
 */
export const branchFor = (login: string, filePath: string, pattern = DEFAULT_BRANCH_PATTERN) =>
  pattern
    .replace('{login}', login)
    .replace('{path}', filePath.replace(/\.md$/, '').replace(/[^A-Za-z0-9._-]+/g, '-'));

/** Repositório do GitHub de um remote do Git. */
export type GitHubRemote = { host: string; slug: string };

const REMOTE_URLS = [
  // https://github.com/dono/repo(.git), com ou sem usuário (https://x-access-token@…)
  /^https?:\/\/(?:[^@/]+@)?([^/:]+(?::\d+)?)\/([^/]+\/[^/]+?)(?:\.git)?\/?$/,
  // ssh://git@github.com(:22)/dono/repo(.git)
  /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+\/[^/]+?)(?:\.git)?\/?$/,
  // git@github.com:dono/repo(.git)
  /^(?:[^@/]+@)?([^/:]+):([^/]+\/[^/]+?)(?:\.git)?\/?$/,
];

/**
 * Host e `dono/repositório` pela URL do remote (https, ssh e o formato curto `git@host:dono/repo`).
 * URL que não é de um repositório (caminho local, `file://`): undefined.
 */
export function parseGitHubRemote(url: string): GitHubRemote | undefined {
  const trimmed = url.trim();
  if (trimmed.startsWith('file:') || trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return undefined;
  for (const pattern of REMOTE_URLS) {
    const match = trimmed.match(pattern);
    if (match) return { host: match[1].toLowerCase(), slug: match[2] };
  }
  return undefined;
}

/** API REST do host: `api.github.com` no github.com, `<host>/api/v3` num GitHub Enterprise Server. */
export const apiBaseUrlFor = (host: string) =>
  host === 'github.com' || host === 'www.github.com' ? DEFAULT_API_BASE_URL : `https://${host}/api/v3`;
