import { GitHubClient, GitHubError } from './github';
import { parseSiteTemplate, SiteTemplate } from './siteTemplates';
import { DocTemplate, parseTemplate } from './templates';

/**
 * Templates centrais da empresa (spec 04, TA3): uma pasta de um repositório do GitHub com o mesmo formato do
 * `.techdocs/templates/` (páginas `.md` e pastas de site com `template.yml`), lida pela API.
 */

/** `techdocsEditor.templates.repository`: `[host/]dono/repo[/pasta][@ref]`. */
export type CentralTemplatesSource = { host: string; slug: string; folder: string; ref?: string };

export function parseTemplatesRepository(value: string | undefined): CentralTemplatesSource | undefined {
  const text = value?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!text) return undefined;
  const at = text.lastIndexOf('@');
  const [path, ref] = at > 0 ? [text.slice(0, at), text.slice(at + 1).trim()] : [text, undefined];
  const parts = path.split('/').filter(Boolean);
  // O primeiro pedaço é o host quando tem ponto (github.com, ghe.empresa.com.br)
  const host = parts[0]?.includes('.') ? parts.shift()!.toLowerCase() : 'github.com';
  if (parts.length < 2 || parts.some(p => p === '..' || p === '.') || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) return undefined;
  if (at > 0 && !ref) return undefined;
  return { host, slug: `${parts[0]}/${parts[1]}`, folder: parts.slice(2).join('/'), ...(ref && { ref }) };
}

/** Como a origem aparece na lista: `dono/repo/pasta`, com o host se não for o github.com. */
export const centralLabel = (source: CentralTemplatesSource) =>
  [source.host === 'github.com' ? '' : source.host, source.slug, source.folder].filter(Boolean).join('/');

/** Os arquivos da pasta, relativos a ela, e o commit de onde vieram. */
export type CentralTemplateFiles = { sha: string; files: Record<string, string> };

/** Limites para uma pasta de templates: só texto e só o que um template usa. */
const MAX_FILES = 300;
const MAX_FILE_BYTES = 256 * 1024;
const TEMPLATE_FILE = /\.(md|ya?ml)$/i;

/**
 * Lê a pasta de templates no commit atual da ref (a branch padrão sem ref). `cachedSha`: o commit da cópia
 * guardada; se não mudou, devolve `'unchanged'` sem baixar nada.
 */
export async function fetchCentralTemplates(
  client: GitHubClient,
  source: CentralTemplatesSource,
  cachedSha?: string,
): Promise<CentralTemplateFiles | 'unchanged'> {
  const ref = source.ref ?? (await client.getRepo()).defaultBranch;
  const commit = await client.getCommit(ref);
  if (!commit) throw new GitHubError(`ref "${ref}" not found`, 404);
  if (commit.sha === cachedSha) return 'unchanged';
  const prefix = source.folder ? `${source.folder}/` : '';
  const { files } = await client.getTree(commit.tree);
  const wanted = files
    .filter(f => f.path.startsWith(prefix) && TEMPLATE_FILE.test(f.path) && f.size <= MAX_FILE_BYTES)
    .map(f => ({ ...f, path: f.path.slice(prefix.length) }))
    // Página no nível da pasta; arquivos de site uma pasta abaixo
    .filter(f => f.path.split('/').length <= 2)
    .slice(0, MAX_FILES);
  const result: Record<string, string> = {};
  for (const file of wanted) result[file.path] = await client.getBlob(file.sha);
  return { sha: commit.sha, files: result };
}

/**
 * Lê os templates centrais primeiro sem login (repositório público) e, se o GitHub recusar (404 ou 401: privado
 * ou sem acesso), com o login. `needsAuth`: já se sabe que o repositório pede login (pula a tentativa sem ele).
 */
export async function loadCentralTemplates(opts: {
  source: CentralTemplatesSource;
  client: (withLogin: boolean) => GitHubClient;
  needsAuth: boolean;
  cachedSha?: string;
}): Promise<{ result: CentralTemplateFiles | 'unchanged'; needsAuth: boolean }> {
  if (!opts.needsAuth) {
    try {
      return { result: await fetchCentralTemplates(opts.client(false), opts.source, opts.cachedSha), needsAuth: false };
    } catch (error) {
      if (!(error instanceof GitHubError) || (error.status !== 404 && error.status !== 401 && error.status !== 403)) throw error;
    }
  }
  return { result: await fetchCentralTemplates(opts.client(true), opts.source, opts.cachedSha), needsAuth: true };
}

/** Templates de página e de site dos arquivos da pasta (o mesmo formato do `.techdocs/templates/`). */
export function centralTemplates(files: Record<string, string>): {
  pages: DocTemplate[];
  sites: { template: SiteTemplate; files: Record<string, string> }[];
} {
  const pages = Object.keys(files)
    .filter(path => !path.includes('/') && /\.md$/i.test(path))
    .sort()
    .map(path => parseTemplate(path.slice(0, -3), files[path]))
    .filter((t): t is DocTemplate => Boolean(t));
  const sites = Object.keys(files)
    .filter(path => /^[^/]+\/template\.yml$/.test(path))
    .sort()
    .flatMap(path => {
      const id = path.split('/')[0];
      const template = parseSiteTemplate(id, files[path]);
      if (!template) return [];
      const own = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith(`${id}/`)).map(([p, text]) => [p.slice(id.length + 1), text]));
      return [{ template, files: own }];
    });
  return { pages, sites };
}
