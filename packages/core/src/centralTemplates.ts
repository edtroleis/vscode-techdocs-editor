import { GitHubClient, GitHubError } from './github';
import { parseSiteTemplate, SiteTemplate } from './siteTemplates';
import { DocTemplate, parseTemplate, TemplateCategory } from './templates';

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
    // Página no nível da pasta ou numa pasta de categoria; site uma pasta abaixo ou em sites/; com as pastas
    // de idioma, um nível a mais (spec 08)
    .filter(f => f.path.split('/').length <= 4)
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

/** As pastas de categoria do Diátaxis (spec 08): a categoria do template sem `category` no front matter. */
const CATEGORY_FOLDERS: Record<string, TemplateCategory> = {
  tutorials: 'tutorial',
  'how-to-guides': 'guide',
  reference: 'reference',
  explanation: 'explanation',
};

const LANGUAGE_FOLDER = /^[a-z]{2}(-[a-z]{2})?$/;

/**
 * Os arquivos do idioma: com pastas de idioma na raiz (`en/`, `pt-br/`), a do idioma pedido (senão a `en`, senão
 * a primeira), sem o prefixo; sem elas, todos (vale para todos os idiomas, como na TA3).
 */
export function languageFolder(files: Record<string, string>, language: string): string | undefined {
  const folders = [...new Set(Object.keys(files).filter(p => p.includes('/')).map(p => p.split('/')[0]))].filter(f => LANGUAGE_FOLDER.test(f)).sort();
  if (!folders.length) return undefined;
  const wanted = language.toLowerCase();
  return folders.find(f => f === wanted) ?? folders.find(f => wanted.startsWith(`${f}-`) || f.startsWith(`${wanted}-`)) ?? folders.find(f => f === 'en') ?? folders[0];
}

export function languageFiles(files: Record<string, string>, language: string): Record<string, string> {
  const folder = languageFolder(files, language);
  if (!folder) return files;
  return Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith(`${folder}/`)).map(([p, text]) => [p.slice(folder.length + 1), text]));
}

/**
 * Templates de página e de site dos arquivos da pasta: o formato do `.techdocs/templates/` (páginas no nível da
 * pasta, sites em subpastas com `template.yml`) e o do repositório de templates (spec 08: pastas de idioma, páginas
 * nas pastas de categoria do Diátaxis, sites em `sites/`).
 */
export function centralTemplates(
  all: Record<string, string>,
  language = 'en',
): {
  pages: DocTemplate[];
  sites: { template: SiteTemplate; files: Record<string, string> }[];
  /** A pasta de idioma usada (`en`, `pt-br`), se o repositório tem pastas de idioma. */
  language?: string;
} {
  const files = languageFiles(all, language);
  const folder = languageFolder(all, language);
  const pages = Object.keys(files)
    .filter(path => /\.md$/i.test(path) && (!path.includes('/') || (path.split('/').length === 2 && path.split('/')[0] in CATEGORY_FOLDERS)))
    .sort()
    .map(path => {
      const parts = path.split('/');
      const name = parts.at(-1)!;
      return parseTemplate(name.slice(0, -3), files[path], parts.length === 2 ? CATEGORY_FOLDERS[parts[0]] : undefined);
    })
    .filter((t): t is DocTemplate => Boolean(t));
  const sites = Object.keys(files)
    .map(path => /^(?:sites\/)?([^/]+)\/template\.yml$/.exec(path))
    .filter((m): m is RegExpExecArray => Boolean(m) && !(m![1] in CATEGORY_FOLDERS) && m![1] !== 'sites')
    .sort((a, b) => a[1].localeCompare(b[1]))
    .flatMap(match => {
      const id = match[1];
      const prefix = match[0].slice(0, -'template.yml'.length);
      const template = parseSiteTemplate(id, files[match[0]]);
      if (!template) return [];
      const own = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith(prefix)).map(([p, text]) => [p.slice(prefix.length), text]));
      return [{ template, files: own }];
    });
  return { pages, sites, ...(folder && { language: folder }) };
}

/**
 * Endereço da página de exemplo de um template da empresa no GitHub (spec 08): `examples/<idioma>/docs/` ao lado
 * da pasta de templates configurada (a convenção do repositório de templates).
 */
export function centralExampleUrl(source: CentralTemplatesSource, language: string | undefined, example: string): string {
  const root = source.folder.split('/').slice(0, -1).join('/');
  const path = [root, 'examples', language, 'docs', example].filter(Boolean).join('/');
  return `https://${source.host}/${source.slug}/blob/${encodeURIComponent(source.ref ?? 'HEAD')}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
