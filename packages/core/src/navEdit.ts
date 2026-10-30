import { isMap, isScalar, isSeq, parseDocument, stringify } from 'yaml';
import type { DocsNode } from './docsTree';
import { dirOf, resolvePath } from './mkdocs';

/**
 * Menu do site (`nav` do `mkdocs.yml`) como dados, para as ações da árvore: mover, renomear e excluir páginas e
 * seções. Página sem `title` fica como no arquivo (`- caminho.md`), com o título vindo da própria página.
 */
export type NavItem =
  | { kind: 'page'; path: string; title?: string }
  | { kind: 'section'; title: string; children: NavItem[] }
  | { kind: 'link'; title: string; url: string };

const isUrl = (path: string) => /^[a-z][a-z0-9+.-]*:/i.test(path);
const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^\.?\//, '');

/** O `nav` do `mkdocs.yml`, ou undefined sem ele (o menu vem das pastas). */
export function readNav(yml: string): NavItem[] | undefined {
  const nav = (parseDocument(yml).toJS() as Record<string, unknown> | null)?.nav;
  if (!Array.isArray(nav)) return undefined;
  const item = (value: unknown, name?: string): NavItem | undefined => {
    if (Array.isArray(value)) return { kind: 'section', title: name ?? '', children: items(value) };
    if (typeof value === 'string') {
      if (isUrl(value) || !/\.md$/i.test(value)) return { kind: 'link', title: name ?? value, url: value };
      return { kind: 'page', path: normalize(value), ...(name === undefined ? {} : { title: name }) };
    }
    if (value && typeof value === 'object') {
      const [entry] = Object.entries(value);
      return entry ? item(entry[1], entry[0]) : undefined;
    }
    return undefined;
  };
  const items = (values: unknown[]): NavItem[] => values.map(v => item(v)).filter((n): n is NavItem => n !== undefined);
  return items(nav);
}

/**
 * O `mkdocs.yml` com o `nav` trocado. Só o bloco do `nav` é reescrito: o resto do arquivo (comentários, tags do
 * MkDocs, a ordem das chaves) fica como está. Sem `nav`, ele entra no fim do arquivo.
 */
export function writeNav(yml: string, nav: NavItem[]): string {
  const plain = (items: NavItem[]): unknown[] =>
    items.map(item =>
      item.kind === 'section' ? { [item.title]: plain(item.children) } : item.kind === 'link' ? { [item.title]: item.url } : item.title === undefined ? item.path : { [item.title]: item.path },
    );
  const body = nav.length
    ? stringify(plain(nav), { lineWidth: 0 })
        .trimEnd()
        .split('\n')
        .map(line => `  ${line}`)
        .join('\n')
    : '  []';
  const doc = parseDocument(yml);
  const pair = isMap(doc.contents) ? doc.contents.items.find(p => isScalar(p.key) && p.key.value === 'nav') : undefined;
  const keyRange = pair && isScalar(pair.key) ? pair.key.range : undefined;
  const valueRange = pair && (isSeq(pair.value) || isScalar(pair.value)) ? pair.value.range : undefined;
  if (!keyRange || !valueRange) {
    const base = yml.length && !yml.endsWith('\n') ? `${yml}\n` : yml;
    return `${base}nav:\n${body}\n`;
  }
  const start = keyRange[0];
  // O fim do valor: o começo da linha seguinte (o YAML conta a quebra de linha na lista em bloco)
  let end = valueRange[1];
  while (end > start && /\s/.test(yml[end - 1])) end--;
  return `${yml.slice(0, start)}nav:\n${body}${yml.slice(end)}`;
}

/** O menu montado pelas pastas (sem `nav`) escrito como `nav`: as mesmas seções, na mesma ordem. */
export function navFromTree(nodes: readonly DocsNode[]): NavItem[] {
  return nodes.map((node): NavItem =>
    node.kind === 'section' ? { kind: 'section', title: node.title, children: navFromTree(node.children) } : node.kind === 'link' ? { kind: 'link', title: node.title, url: node.url } : { kind: 'page', path: node.path },
  );
}

/** Onde está um item: a lista que o contém e a posição nela. */
export type NavPlace = { list: NavItem[]; index: number };

/** A página no menu (a primeira vez que aparece). */
export function findPage(nav: NavItem[], path: string): NavPlace | undefined {
  for (const [index, item] of nav.entries()) {
    if (item.kind === 'page' && item.path === path) return { list: nav, index };
    if (item.kind === 'section') {
      const found = findPage(item.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

/** A seção pelos títulos desde a raiz (`['Guias', 'Instalação']`). */
export function findSection(nav: NavItem[], trail: readonly string[]): NavPlace | undefined {
  let list = nav;
  let place: NavPlace | undefined;
  for (const title of trail) {
    const index = list.findIndex(item => item.kind === 'section' && item.title === title);
    if (index < 0) return undefined;
    place = { list, index };
    list = (list[index] as Extract<NavItem, { kind: 'section' }>).children;
  }
  return place;
}

/**
 * Onde entra uma página que ainda não está no menu: na lista da seção mais funda com outra página da mesma pasta
 * (`operacao/estorno.md` vai para a seção de `operacao/alertas.md`); sem nenhuma, ou da raiz do `docs_dir`, na raiz
 * do menu (uma seção com uma página solta da raiz não é a seção da raiz).
 */
export function listForPage(nav: NavItem[], path: string): NavItem[] {
  const folder = (page: string) => page.slice(0, page.lastIndexOf('/') + 1);
  if (!folder(path)) return nav;
  let best: { list: NavItem[]; depth: number } = { list: nav, depth: -1 };
  const walk = (list: NavItem[], depth: number) => {
    for (const item of list) {
      if (item.kind === 'page' && folder(item.path) === folder(path) && depth > best.depth) best = { list, depth };
      if (item.kind === 'section') walk(item.children, depth + 1);
    }
  };
  walk(nav, 0);
  return best.list;
}

/** As páginas de um item (a própria, ou todas as de dentro da seção). */
export function pagesOf(item: NavItem): string[] {
  return item.kind === 'page' ? [item.path] : item.kind === 'section' ? item.children.flatMap(pagesOf) : [];
}

/** Os destinos de links (`[x](a.md)`, `![x](img.png)`, `[x]: a.md`) de uma página, relativos ao `docs_dir`. */
export function linkTargets(markdown: string, pagePath: string): string[] {
  const dir = dirOf(pagePath);
  const found = new Set<string>();
  const add = (raw: string) => {
    const target = raw.trim().replace(/^<|>$/g, '').split(/[#?]/)[0];
    if (!target || isUrl(target) || target.startsWith('/')) return;
    let decoded = target;
    try {
      decoded = decodeURI(target);
    } catch {
      // Endereço com % solto: fica como está
    }
    found.add(resolvePath(dir, decoded));
  };
  for (const match of markdown.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)/g)) add(match[1]);
  for (const match of markdown.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) add(match[1]);
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(match[1]);
  return [...found];
}

/** As páginas (caminhos) que têm link para `target`. */
export function pagesLinkingTo(target: string, pages: ReadonlyArray<{ path: string; text: string }>): string[] {
  return pages.filter(p => p.path !== target && linkTargets(p.text, p.path).includes(target)).map(p => p.path);
}

/** Os arquivos que não são páginas (imagens, anexos) usados pela página e por nenhuma outra. */
export function filesOnlyUsedBy(page: { path: string; text: string }, others: ReadonlyArray<{ path: string; text: string }>): string[] {
  const used = new Set(others.filter(o => o.path !== page.path).flatMap(o => linkTargets(o.text, o.path)));
  return linkTargets(page.text, page.path).filter(path => !/\.md$/i.test(path) && !used.has(path));
}

/**
 * O texto da página com outro título: o `title` do front matter, se houver; senão o primeiro título 1 (fora de
 * bloco de código); sem nenhum, um título 1 no começo.
 */
export function setPageTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  if (lines[0]?.replace(/\r$/, '') === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---');
    const at = end > 0 ? lines.slice(1, end).findIndex(l => /^title:/.test(l)) : -1;
    if (at >= 0) {
      lines[at + 1] = `title: ${stringify(title, { lineWidth: 0 }).trimEnd()}`;
      return lines.join('\n');
    }
  }
  let fence: string | undefined;
  for (const [i, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? undefined : marker;
      continue;
    }
    if (fence) continue;
    const heading = /^#\s+(.+?)(\s*\{[^}]*\})?\s*#*\s*(\r?)$/.exec(line);
    if (heading) {
      lines[i] = `# ${title}${heading[2] ?? ''}${heading[3]}`;
      return lines.join('\n');
    }
  }
  // Sem título: entra no começo (depois do front matter)
  const afterMeta = lines[0]?.replace(/\r$/, '') === '---' ? lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---') + 1 : 0;
  lines.splice(afterMeta, 0, `# ${title}`, '');
  return lines.join('\n');
}
