import { parseGitHubRemote } from './publish';

/**
 * Endereços do modo remoto (spec 02, M2, B1 e B3; fase 4b): a URI `techdocs://<host>/<dono>/<repo>/<caminho>`,
 * o que a pessoa digita em "Abrir documentação do GitHub…" e o link `vscode://edtroleis.techdocs-editor/open?…`.
 */

export const REMOTE_SCHEME = 'techdocs';

export type RemoteRepoRef = { host: string; slug: string };
/** Um repositório e, se houver, um arquivo ou pasta dentro dele. */
export type RemoteTarget = RemoteRepoRef & { path?: string };

/** Nome de dono ou de repositório do GitHub (letras, números, `-`, `_`, `.`), sem ser `.` ou `..`. */
const NAME = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;
const isSlug = (slug: string) => {
  const parts = slug.split('/');
  return parts.length === 2 && parts.every(part => NAME.test(part));
};

/**
 * Caminho dentro do repositório, ou undefined se ele pode sair do repositório ou é malformado: sem `..` ou `.`,
 * sem barra no começo, barra dupla ou barra invertida e sem caracteres de controle.
 */
export function safeRepoPath(path: string): string | undefined {
  if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  return path.split('/').every(part => part && part !== '.' && part !== '..') ? path : undefined;
}

/** Path da URI `techdocs:` (o host vai na autoridade). */
export const remoteUriPath = (slug: string, path: string) => (path ? `/${slug}/${path}` : `/${slug}`);

/** Repositório e caminho de uma URI `techdocs:` (autoridade e path); undefined se ela é inválida. */
export function parseRemoteUri(authority: string, uriPath: string): (RemoteRepoRef & { path: string }) | undefined {
  const [owner, repo, ...rest] = uriPath.replace(/^\/+/, '').split('/');
  const slug = `${owner}/${repo ?? ''}`;
  if (!authority || !isSlug(slug)) return undefined;
  const path = rest.join('/');
  if (path && !safeRepoPath(path)) return undefined;
  return { host: authority.toLowerCase(), slug, path };
}

/**
 * O que a pessoa digitou: `dono/repo`, a URL do repositório (https ou ssh) ou de um arquivo ou pasta dele
 * (`/blob/<branch>/<caminho>`, `/tree/<branch>/<caminho>`). A branch da URL não é guardada: abre-se o
 * rascunho da pessoa ou a branch principal, como sempre (M2).
 */
export function parseRemoteInput(text: string, defaultHost = 'github.com'): RemoteTarget | undefined {
  const trimmed = text.trim().replace(/\/+$/, '');
  if (isSlug(trimmed)) return { host: defaultHost.trim().toLowerCase(), slug: trimmed };
  const page = trimmed.match(/^https:\/\/([^/]+)\/([^/]+\/[^/]+)\/(?:blob|tree)\/[^/]+\/(.+)$/);
  if (page) {
    const slug = page[2].replace(/\.git$/, '');
    const path = safeRepoPath(page[3]);
    return isSlug(slug) && path ? { host: page[1].toLowerCase(), slug, path } : undefined;
  }
  if (!/^(https:\/\/|git@|ssh:\/\/)/.test(trimmed)) return undefined;
  const remote = parseGitHubRemote(trimmed);
  return remote && isSlug(remote.slug) ? remote : undefined;
}

/** Hosts aceitos nos links: o github.com e o da configuração (`techdocsEditor.github.host`). */
export function allowedHosts(configured: string | undefined): string[] {
  const host = configured?.trim().toLowerCase();
  return host && host !== 'github.com' ? ['github.com', host] : ['github.com'];
}

export type OpenLinkResult =
  | { ok: true; target: Required<RemoteTarget> }
  | { ok: false; reason: 'host' | 'repo' | 'path' };

/**
 * Parâmetros do link `vscode://edtroleis.techdocs-editor/open?host=…&repo=…&path=…` (B1). Validados (B3):
 * host da lista, `dono/repo` bem formado e o caminho de uma página `.md` dentro do repositório. O link só abre.
 */
export function validateOpenLink(query: string, hosts: readonly string[]): OpenLinkResult {
  const params = new URLSearchParams(query);
  const host = params.get('host')?.trim().toLowerCase() ?? '';
  if (!hosts.includes(host)) return { ok: false, reason: 'host' };
  const slug = params.get('repo')?.trim() ?? '';
  if (!isSlug(slug)) return { ok: false, reason: 'repo' };
  const path = safeRepoPath(params.get('path')?.trim() ?? '');
  if (!path || !/\.md$/i.test(path)) return { ok: false, reason: 'path' };
  return { ok: true, target: { host, slug, path } };
}
