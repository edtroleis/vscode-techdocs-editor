import { isMap, isScalar, isSeq, parseDocument, stringify, type YAMLSeq } from 'yaml';

/**
 * Árvore das páginas de um site do MkDocs (spec 02, LC6), como o menu do site publicado: pelo `nav` do
 * `mkdocs.yml` ou, sem ele, pelas pastas do `docs_dir`. Caminhos relativos ao `docs_dir`, com `/`.
 */
export type DocsNode =
  | { kind: 'page'; title: string; path: string; missing?: boolean }
  | { kind: 'section'; title: string; children: DocsNode[] }
  | { kind: 'link'; title: string; url: string };

export type DocsTree = {
  nodes: DocsNode[];
  /** Páginas do `docs_dir` fora do `nav` (o MkDocs avisa e não as põe no menu). Vazio sem `nav`. */
  notInNav: DocsNode[];
};

/** `mkdocs.yml` lido; as tags do MkDocs (`!!python/name`, `!ENV`) ficam só como aviso. */
const readYml = (yml: string | undefined) => (yml ? parseDocument(yml).toJS() : undefined) as
  | Record<string, unknown>
  | undefined;

export function siteName(yml: string | undefined): string | undefined {
  const name = readYml(yml)?.site_name;
  return typeof name === 'string' ? name : undefined;
}

const isIndex = (name: string) => /^(index|readme)\.md$/i.test(name);
const isUrl = (path: string) => /^[a-z][a-z0-9+.-]*:/i.test(path);

/** Título a partir do nome do arquivo ou pasta, como o MkDocs: `primeiros-passos` → "Primeiros passos". */
export function nameToTitle(name: string): string {
  const title = name.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
  return title === title.toLowerCase() ? title.charAt(0).toUpperCase() + title.slice(1) : title;
}

/** Título da página sem um no `nav`: `index.md` leva o nome da pasta ("Home" na raiz). */
function fallbackTitle(path: string): string {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  if (!isIndex(name)) return nameToTitle(name);
  return parts.length > 1 ? nameToTitle(parts[parts.length - 2]) : 'Home';
}

/**
 * Título da página como o MkDocs mostra: `title` do front matter, senão o primeiro título 1 (fora de
 * bloco de código), senão undefined (fica o nome do arquivo).
 */
export function pageTitle(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    const meta = end > 0 ? lines.slice(1, end).find(l => /^title:/.test(l)) : undefined;
    const title = meta?.replace(/^title:\s*/, '').replace(/^(['"])(.*)\1$/, '$2').trim();
    if (title) return title;
  }
  let fence: string | undefined;
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? undefined : marker;
      continue;
    }
    if (fence) continue;
    const heading = /^#\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (heading) return heading.replace(/\s*\{[^}]*\}$/, '').trim() || undefined;
  }
  return undefined;
}

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^\.?\//, '');

/**
 * Árvore do site. `pages`: os `.md` do `docs_dir`; `titleOf`: o título de cada um (ver `pageTitle`).
 */
export function docsTree(
  yml: string | undefined,
  pages: readonly string[],
  titleOf: (path: string) => string | undefined = () => undefined,
): DocsTree {
  const title = (path: string) => titleOf(path) ?? fallbackTitle(path);
  const nav = readYml(yml)?.nav;
  if (!Array.isArray(nav)) return { nodes: folderTree(pages, title), notInNav: [] };

  const existing = new Set(pages);
  const inNav = new Set<string>();
  const item = (value: unknown, name?: string): DocsNode | undefined => {
    if (Array.isArray(value)) return { kind: 'section', title: name ?? '', children: items(value) };
    if (typeof value === 'string') {
      if (isUrl(value) || !/\.md$/i.test(value)) return { kind: 'link', title: name ?? value, url: value };
      const path = normalize(value);
      inNav.add(path);
      return { kind: 'page', title: name ?? title(path), path, ...(existing.has(path) ? {} : { missing: true }) };
    }
    if (value && typeof value === 'object') {
      const [entry] = Object.entries(value);
      return entry ? item(entry[1], entry[0]) : undefined;
    }
    return undefined;
  };
  const items = (values: unknown[]) => values.map(v => item(v)).filter((n): n is DocsNode => n !== undefined);
  const nodes = items(nav);
  const notInNav = pages
    .filter(p => !inNav.has(p))
    .sort()
    .map((path): DocsNode => ({ kind: 'page', title: title(path), path }));
  return { nodes, notInNav };
}

/** Sem `nav`: pastas viram seções; em cada pasta, `index.md` primeiro, as páginas, e então as subpastas. */
function folderTree(pages: readonly string[], title: (path: string) => string): DocsNode[] {
  type Folder = { pages: string[]; folders: Map<string, Folder> };
  const root: Folder = { pages: [], folders: new Map() };
  for (const path of pages) {
    const parts = path.split('/');
    let folder = root;
    for (const dir of parts.slice(0, -1)) {
      if (!folder.folders.has(dir)) folder.folders.set(dir, { pages: [], folders: new Map() });
      folder = folder.folders.get(dir)!;
    }
    folder.pages.push(path);
  }
  const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const build = (folder: Folder): DocsNode[] => [
    ...[...folder.pages]
      .sort((a, b) => Number(isIndex(fileName(b))) - Number(isIndex(fileName(a))) || fileName(a).localeCompare(fileName(b)))
      .map((path): DocsNode => ({ kind: 'page', title: title(path), path })),
    ...[...folder.folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sub]): DocsNode => ({ kind: 'section', title: nameToTitle(name), children: build(sub) })),
  ];
  return build(root);
}

/** Página posta no `nav` (TP6): o `mkdocs.yml` novo e a seção onde ela entrou (títulos, vazio na raiz). */
export type NavInsertion = { yml: string; section: string[] };

/**
 * Põe a página no fim de uma seção do `nav`: a seção dada (títulos desde a raiz, como na árvore); sem ela, a
 * seção com outra página da mesma pasta; senão, o fim do `nav`. Só insere uma linha, com o recuo da lista:
 * comentários, tags do MkDocs e a formatação do resto do arquivo ficam como estão. Sem `nav` (o menu vem das
 * pastas), com `nav` em formato de fluxo (`[a, b]`) ou a página já no `nav`: undefined.
 */
export function addToNav(yml: string, path: string, title: string, section?: string[]): NavInsertion | undefined {
  const doc = parseDocument(yml);
  const nav = doc.get('nav', true);
  if (!isSeq(nav) || nav.flow || !nav.items.length || !nav.range) return undefined;

  type Section = { seq: YAMLSeq; trail: string[]; folders: Set<string> };
  const sections: Section[] = [];
  let inNav = false;
  const folder = (page: string) => page.slice(0, page.lastIndexOf('/') + 1);
  const walk = (seq: YAMLSeq, trail: string[]) => {
    const current: Section = { seq, trail, folders: new Set() };
    sections.push(current);
    for (const item of seq.items) {
      let value: unknown = item;
      let name: string | undefined;
      if (isMap(item) && item.items.length === 1) {
        const [pair] = item.items;
        name = isScalar(pair.key) ? String(pair.key.value) : undefined;
        value = pair.value;
      }
      if (isSeq(value) && name !== undefined) {
        if (!value.flow && value.items.length && value.range) walk(value, [...trail, name]);
      } else if (isScalar(value) && typeof value.value === 'string' && /\.md$/i.test(value.value) && !isUrl(value.value)) {
        const page = normalize(value.value);
        if (page === path) inNav = true;
        current.folders.add(folder(page));
      }
    }
  };
  walk(nav as YAMLSeq, []);
  if (inNav) return undefined;

  const same = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);
  const target =
    (section && sections.find(s => same(s.trail, section))) ??
    sections.filter(s => s.folders.has(folder(path))).sort((a, b) => b.trail.length - a.trail.length)[0] ??
    sections[0];

  // A lista termina no começo da linha seguinte (com os comentários da última linha); o recuo é o do primeiro `-`
  const [start, end] = target.seq.range!;
  const indent = start - (yml.lastIndexOf('\n', start - 1) + 1);
  const entry = stringify({ [title]: path }, { lineWidth: 0 }).trimEnd();
  const line = `${' '.repeat(indent)}- ${entry}\n`;
  const at = yml[end - 1] === '\n' ? end : yml.length;
  const before = yml.slice(0, at);
  return { yml: (before.endsWith('\n') ? before : `${before}\n`) + line + yml.slice(at), section: target.trail };
}
