/**
 * O que vai num envio (spec 09): os arquivos da documentação que mudaram no repositório, agrupados por site e
 * traduzidos em itens que a pessoa entende (página alterada, nova, movida, removida, imagens, menu do site).
 * Caminhos relativos à raiz do repositório, com `/`.
 */
import { nameToTitle, pageTitle } from './docsTree';
import { LINT_CONFIG_FILES } from './lint';

/** Um site do repositório: `root` é a pasta do `mkdocs.yml` ('' = raiz). */
export type SendSite = { root: string; docsDir: string; mkdocs: string; title: string };
export type FileChange = { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; from?: string };
export type SendItem =
  | { kind: 'page'; change: 'added' | 'modified' | 'deleted'; path: string; site: string; title: string }
  | { kind: 'moved'; from: string; path: string; site: string; title: string }
  | { kind: 'images'; paths: string[]; site: string; usedIn: string[] }
  | { kind: 'menu'; path: string; site: string }
  | { kind: 'siteFile'; path: string; site: string };
export type SendGroup = { site: SendSite; items: SendItem[] };
type T = (message: string, ...args: Array<string | number>) => string;

/** Arquivos do site ao lado do `mkdocs.yml` que vão no envio. */
const SITE_FILES = ['catalog-info.yaml', '.techdocs-editor.yaml', ...LINT_CONFIG_FILES];
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;
/** Links do Markdown e `src` de HTML. */
export const LINKS = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\bsrc=["']([^"']+)["']/g;

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const inside = (path: string, dir: string) => !dir || path.startsWith(`${dir}/`);
const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** O site mais fundo cujo `docs_dir` ou arquivos de site contêm o caminho. */
export function siteOf(path: string, sites: SendSite[]): SendSite | undefined {
  const owns = (site: SendSite) =>
    inside(path, site.docsDir) || path === site.mkdocs || SITE_FILES.some(name => path === join(site.root, name));
  return sites.filter(owns).sort((a, b) => b.docsDir.length - a.docsDir.length)[0];
}

export function isDocsFile(path: string, sites: SendSite[]): boolean {
  return siteOf(path, sites) !== undefined;
}

/** Normaliza `a/./b/../c` em `a/c`. */
function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function linkedImages(page: string, text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(LINKS)]
    .map(m => (m[1] ?? m[2]).split(/[?#]/)[0])
    .filter(link => !/^[a-z]+:|^\//i.test(link))
    .map(link => normalize(join(dirname(page), decodeURI(link))));
}

const ORDER = { modified: 0, added: 1, moved: 2, deleted: 3, images: 4, menu: 5, siteFile: 6 };
const rank = (item: SendItem) => (item.kind === 'page' ? ORDER[item.change] : ORDER[item.kind]);

export function sendGroups(
  changes: FileChange[],
  sites: SendSite[],
  pageText: (path: string) => string | undefined,
): { groups: SendGroup[]; outside: string[] } {
  const outside: string[] = [];
  const bySite = new Map<SendSite, { items: SendItem[]; images: string[] }>();
  const titleOf = (path: string) => pageTitle(pageText(path) ?? '') ?? nameToTitle(path.slice(path.lastIndexOf('/') + 1));
  for (const change of changes) {
    const site = siteOf(change.path, sites);
    if (!site) {
      outside.push(change.path);
      continue;
    }
    const entry = bySite.get(site) ?? { items: [], images: [] };
    bySite.set(site, entry);
    const base = { path: change.path, site: site.root };
    if (change.path === site.mkdocs) entry.items.push({ kind: 'menu', ...base });
    else if (!inside(change.path, site.docsDir)) entry.items.push({ kind: 'siteFile', ...base });
    else if (IMAGE.test(change.path)) entry.images.push(change.path);
    else if (change.status === 'renamed' && change.from)
      entry.items.push({ kind: 'moved', from: change.from, ...base, title: titleOf(change.path) });
    else
      entry.items.push({
        kind: 'page',
        change: change.status === 'renamed' ? 'added' : change.status,
        ...base,
        title: titleOf(change.path),
      });
  }
  const groups: SendGroup[] = [];
  // Na ordem dos sites (a da árvore)
  for (const site of sites) {
    const entry = bySite.get(site);
    if (!entry) continue;
    if (entry.images.length) {
      const images = new Set(entry.images.sort());
      const usedIn = entry.items
        .filter((item): item is Extract<SendItem, { title: string }> => 'title' in item)
        .map(item => item.path)
        .filter(page => linkedImages(page, pageText(page)).some(image => images.has(image)));
      entry.items.push({ kind: 'images', paths: [...images], site: site.root, usedIn });
    }
    groups.push({ site, items: entry.items.sort((a, b) => rank(a) - rank(b)) });
  }
  return { groups, outside };
}

export function itemCount(groups: SendGroup[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

export function itemPaths(item: SendItem): string[] {
  if (item.kind === 'images') return item.paths;
  if (item.kind === 'moved') return [item.from, item.path];
  return [item.path];
}

function list(names: string[], t: T) {
  return names.length > 1 ? t('{0} and {1}', names.slice(0, -1).join(', '), names[names.length - 1]) : names[0];
}

function siteSummary(items: SendItem[], t: T) {
  const titles = (pick: (item: SendItem) => boolean) =>
    items.filter(pick).map(item => ('title' in item ? item.title : ''));
  const parts: string[] = [];
  const add = (message: string, names: string[]) => names.length && parts.push(t(message, list(names, t)));
  add('updates {0}', titles(i => i.kind === 'page' && i.change === 'modified'));
  add('creates {0}', titles(i => i.kind === 'page' && i.change === 'added'));
  add('moves {0}', titles(i => i.kind === 'moved'));
  add('removes {0}', titles(i => i.kind === 'page' && i.change === 'deleted'));
  // Só imagens ou só o menu: diz isso, senão o resumo fica vazio
  if (!parts.length && items.some(i => i.kind === 'menu')) parts.push(t('updates the menu'));
  if (!parts.length && items.some(i => i.kind === 'images')) parts.push(t('adds images'));
  return parts.join('; ');
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** O "O que mudou" da tela de envio, que vira o título do pedido de revisão. */
export function sendSummary(groups: SendGroup[], t: T): string {
  if (groups.length === 1) return capitalize(siteSummary(groups[0].items, t));
  return groups.map(group => `${group.site.title}: ${siteSummary(group.items, t)}`).join('. ');
}
