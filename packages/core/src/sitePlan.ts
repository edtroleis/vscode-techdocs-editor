import { nameToTitle, pageTitle } from './docsTree';
import { catalogInfoSkeleton } from './siteCheck';
import { readmeAsHome, SitePage, siteMkdocsYml } from './siteTemplates';
import { DocTemplate, fileNameFor, fillTemplate, nextNumber } from './templates';

/**
 * Prévia da documentação nova (layout validado em 2026-10-29): o que a pessoa escolheu na barra lateral vira a lista
 * de arquivos, o menu e o `mkdocs.yml`, antes de gravar qualquer coisa. Sem `vscode`: a extensão lê o disco, chama
 * `planSite` a cada mudança e grava só no "Criar".
 */

/** O README.md como página inicial: copiado, movido (fica um link para as docs) ou não usado. */
export type ReadmeUse = 'copy' | 'move' | 'skip';

/** Página que a pessoa acrescentou na prévia; `template`: o id do template de página (sem ele, só o título). */
export type AddedPage = { path: string; title: string; section?: string; template?: string };

/** O que a pessoa mexeu na prévia. Caminhos relativos à pasta do site (`docs/x.md`, `catalog-info.yaml`). */
export type PlanEdits = {
  /** Arquivos desmarcados (páginas do template e o `catalog-info.yaml`). */
  off: string[];
  /** Ordem do menu: o caminho da página no `docs_dir` ou `section:<nome original>`. */
  order: string[];
  /** Título no menu, pelo caminho no `docs_dir`. */
  titles: Record<string, string>;
  /** Nome novo de cada seção, pelo nome original. */
  sections: Record<string, string>;
  added: AddedPage[];
  /** Páginas que já existem e que o template substitui (o padrão é manter). */
  replace: string[];
};

export const emptyEdits = (): PlanEdits => ({ off: [], order: [], titles: {}, sections: {}, added: [], replace: [] });

export type PlanInput = {
  siteName: string;
  /** Pasta das páginas, relativa à do site. */
  docsDir: string;
  /** Páginas do template com os campos preenchidos; undefined: sem template (só as páginas que já existem). */
  template?: { pages: SitePage[]; nav: boolean; mkdocs: Record<string, unknown> };
  /** Páginas que já existem no `docs_dir`, relativas a ele; as de uma subpasta ficam na seção com o nome dela. */
  existing: { path: string; title?: string }[];
  /** O README.md da pasta do site; `pointer`: o texto que fica nele quando é movido. */
  readme?: { path: string; text: string; use: ReadmeUse; pointer: string };
  /** O `catalog-info.yaml` a criar (só quando a pasta não tem um). */
  catalog?: { name: string; owner: string; annotation: string; title?: string; description?: string };
  /** O texto do `.markdownlint.yaml` a criar na pasta do site (só quando o repositório não tem um). */
  lint?: string;
  /** Templates de página, para o texto das páginas acrescentadas. */
  pageTemplates: Pick<DocTemplate, 'id' | 'body' | 'fields'>[];
  /** Campos automáticos das páginas acrescentadas (`date`, `owner`, `site_name`). */
  values: Record<string, string>;
  edits: PlanEdits;
};

export type PlanFileStatus = 'new' | 'modified' | 'unchanged';
export type PlanOrigin = 'mkdocs' | 'catalog' | 'lint' | 'readme' | 'template' | 'added' | 'existing';

export type PlanFile = {
  /** Relativo à pasta do site. */
  path: string;
  status: PlanFileStatus;
  origin: PlanOrigin;
  /** Texto a gravar (undefined quando o arquivo não muda). */
  content?: string;
  /** Pode ser desmarcado. */
  optional: boolean;
  included: boolean;
  /** Página que já existe e que o template também traz: `replace` diz o que a pessoa escolheu. */
  conflict?: { replace: boolean };
  /** O texto veio do README (`copy`/`move`), ou o README que fica (`copy`) ou vira link (`move`). */
  readme?: ReadmeUse;
};

export type PlanNavPage = { path: string; title: string; included: boolean; origin: PlanOrigin; status: PlanFileStatus; conflict?: boolean };
export type PlanNavEntry =
  | { kind: 'page'; key: string; page: PlanNavPage }
  | { kind: 'section'; key: string; name: string; original: string; pages: PlanNavPage[] };

export type SitePlan = {
  files: PlanFile[];
  nav: PlanNavEntry[];
  /** Campos que faltam para criar: o nome do site sempre; o dono, só com o `catalog-info.yaml` marcado. */
  missing: ('siteName' | 'owner')[];
};

const CATALOG = 'catalog-info.yaml';
const LINT = '.markdownlint.yaml';
const isHome = (path: string) => /^(index|readme)\.md$/i.test(path);

type Page = PlanNavPage & { section?: string; content?: string; readme?: ReadmeUse };

/** O plano: arquivos, menu e campos que faltam. */
export function planSite(input: PlanInput): SitePlan {
  const { edits } = input;
  const off = new Set(edits.off);
  const docs = (path: string) => `${input.docsDir}/${path}`;
  const pages: Page[] = input.existing.map(e => ({
    path: e.path,
    title: e.title ?? nameToTitle(e.path.split('/').pop()!),
    ...(e.path.includes('/') && { section: nameToTitle(e.path.split('/')[0]) }),
    included: true,
    origin: 'existing',
    status: 'unchanged',
  }));
  const hasHome = pages.some(p => isHome(p.path));
  const readmeUse = input.readme && input.readme.use !== 'skip' && !hasHome ? input.readme.use : undefined;

  for (const page of input.template?.pages ?? []) {
    const content = readmeUse && page.path === 'index.md' ? readmeAsHome(input.readme!.text) : page.content;
    const existing = pages.find(p => p.path === page.path);
    if (existing) {
      existing.conflict = true;
      if (edits.replace.includes(page.path)) Object.assign(existing, { status: 'modified', content, section: page.section, title: page.title });
      continue;
    }
    pages.push({
      path: page.path,
      title: page.title,
      section: page.section,
      content,
      included: !off.has(docs(page.path)),
      origin: 'template',
      status: 'new',
      ...(content !== page.content && { readme: readmeUse }),
    });
  }
  // Sem template e sem página inicial: o README vira a página inicial
  if (readmeUse && !pages.some(p => isHome(p.path))) {
    const text = input.readme!.text;
    pages.unshift({ path: 'index.md', title: pageTitle(text) ?? input.siteName, content: readmeAsHome(text), included: true, origin: 'readme', status: 'new', readme: readmeUse });
  }
  for (const added of edits.added) {
    if (pages.some(p => p.path === added.path)) continue;
    const template = input.pageTemplates.find(t => t.id === added.template);
    pages.push({ ...added, content: addedContent(template, added.title, input.values), included: true, origin: 'added', status: 'new' });
  }
  for (const page of pages) {
    page.title = edits.titles[page.path]?.trim() || page.title;
    if (page.section) page.section = edits.sections[page.section]?.trim() || page.section;
  }

  const nav = navEntries(pages, edits);
  const ordered = nav.flatMap(e => (e.kind === 'page' ? [e.page as Page] : (e.pages as Page[])));
  const sitePages: SitePage[] = ordered.filter(p => p.included).map(p => ({ path: p.path, title: p.title, section: p.section, content: '' }));
  const mkdocs = siteMkdocsYml(input.siteName.trim(), sitePages, { nav: input.template?.nav ?? true, mkdocs: input.template?.mkdocs ?? {} });

  const files: PlanFile[] = [{ path: 'mkdocs.yml', status: 'new', origin: 'mkdocs', content: mkdocs, optional: false, included: true }];
  const catalogOn = Boolean(input.catalog) && !off.has(CATALOG);
  if (input.catalog) {
    files.push({ path: CATALOG, status: 'new', origin: 'catalog', content: catalogInfoSkeleton(input.catalog), optional: true, included: catalogOn });
  }
  // As regras do lint ficam no repositório: a pipeline e quem edita sem a extensão usam as mesmas
  if (input.lint !== undefined) files.push({ path: LINT, status: 'new', origin: 'lint', content: input.lint, optional: true, included: !off.has(LINT) });
  for (const page of [...pages].sort((a, b) => a.path.localeCompare(b.path))) {
    files.push({
      path: docs(page.path),
      status: page.status,
      origin: page.origin,
      content: page.content,
      optional: page.origin === 'template',
      included: page.included,
      ...(page.conflict && { conflict: { replace: page.status === 'modified' } }),
      ...(page.readme && { readme: page.readme }),
    });
  }
  if (input.readme && readmeUse) {
    const title = pageTitle(input.readme.text) ?? input.siteName;
    files.push(
      readmeUse === 'move'
        ? { path: input.readme.path, status: 'modified', origin: 'readme', content: `# ${title}\n\n${input.readme.pointer}\n`, optional: false, included: true, readme: 'move' }
        : { path: input.readme.path, status: 'unchanged', origin: 'readme', optional: false, included: true, readme: 'copy' },
    );
  }

  const missing: SitePlan['missing'] = [];
  if (!input.siteName.trim()) missing.push('siteName');
  if (catalogOn && !input.catalog!.owner.trim()) missing.push('owner');
  return { files, nav: nav.map(stripPage), missing };
}

function addedContent(template: Pick<DocTemplate, 'body' | 'fields'> | undefined, title: string, values: Record<string, string>) {
  if (!template) return `# ${title}\n`;
  const defaults = Object.fromEntries(template.fields.map(f => [f.name, f.default]));
  return fillTemplate(template.body, { ...defaults, ...values, title });
}

/** Entradas do menu (página solta ou seção), na ordem escolhida; as que não estão em `order` vêm depois, na ordem natural. */
function navEntries(pages: Page[], edits: PlanEdits): PlanNavEntry[] {
  const entries: PlanNavEntry[] = [];
  for (const page of pages) {
    if (!page.section) {
      entries.push({ kind: 'page', key: page.path, page });
      continue;
    }
    const original = Object.entries(edits.sections).find(([, name]) => name.trim() === page.section)?.[0] ?? page.section;
    const key = `section:${original}`;
    let entry = entries.find((e): e is Extract<PlanNavEntry, { kind: 'section' }> => e.key === key);
    if (!entry) entries.push((entry = { kind: 'section', key, name: page.section, original, pages: [] }));
    entry.pages.push(page);
  }
  const natural = new Map(entries.map((e, i) => [e.key, i]));
  const rank = (key: string) => {
    const i = edits.order.indexOf(key);
    return i < 0 ? 1e6 + natural.get(key)! : i;
  };
  return entries.sort((a, b) => rank(a.key) - rank(b.key));
}

/** O menu sem o texto das páginas (vai para o webview). */
function stripPage(entry: PlanNavEntry): PlanNavEntry {
  const strip = ({ path, title, included, origin, status, conflict }: Page): PlanNavPage => ({ path, title, included, origin, status, ...(conflict && { conflict }) });
  return entry.kind === 'page' ? { ...entry, page: strip(entry.page as Page) } : { ...entry, pages: (entry.pages as Page[]).map(strip) };
}

/** Ordem do menu depois de mover a entrada `key` uma posição (`delta` -1 ou 1), ou de pô-la antes de `before`. */
export function moveNavEntry(nav: PlanNavEntry[], key: string, to: { delta: number } | { before: string }): string[] {
  const order = nav.map(e => e.key);
  const i = order.indexOf(key);
  if (i < 0) return order;
  if ('delta' in to) {
    const j = i + to.delta;
    if (j < 0 || j >= order.length) return order;
    [order[i], order[j]] = [order[j], order[i]];
    return order;
  }
  order.splice(i, 1);
  const target = order.indexOf(to.before);
  order.splice(target < 0 ? order.length : target, 0, key);
  return order;
}

/**
 * A página que o texto digitado na prévia cria (undefined se não dá): na visão Arquivos, `text` é o caminho
 * (`guias/deploy.md`) e o título sai do nome, ou é o próprio texto se ele não é um nome de arquivo (`Referência da API`); na visão Menu, é o título e o caminho sai dele, na pasta da seção.
 * O template de página decide a pasta (`folder`) e o número (`numbered`, como os ADRs). Nunca repete um caminho.
 */
export function newPagePath(
  text: string,
  opts: { by: 'path' | 'title'; section?: string; template?: Pick<DocTemplate, 'id' | 'folder' | 'numbered'> },
  plan: Pick<SitePlan, 'nav'>,
): AddedPage | undefined {
  const typed = text.trim();
  if (!typed) return undefined;
  const pages = plan.nav.flatMap(e => (e.kind === 'page' ? [{ ...e.page, section: undefined as string | undefined }] : e.pages.map(p => ({ ...p, section: e.original }))));
  const taken = new Set(pages.map(p => p.path));
  const unique = (base: string) => {
    let path = `${base}.md`;
    for (let i = 2; taken.has(path); i++) path = `${base}-${i}.md`;
    return path;
  };
  const sectionOf = (folder: string) => pages.find(p => p.section && p.path.startsWith(`${folder}/`))?.section;
  const template = opts.template && { template: opts.template.id };

  if (opts.by === 'path') {
    const typedParts = typed.split(/[\\/]+/).map(part => part.replace(/\.md$/i, '').trim()).filter(Boolean);
    const parts = typedParts.map(part => fileNameFor(part).replace(/\.md$/, '')).filter(Boolean);
    if (!parts.length || typed.includes('..')) return undefined;
    const folder = parts.slice(0, -1).join('/') || opts.template?.folder || '';
    const name = parts[parts.length - 1];
    // "Referência da API" é um título: fica como foi digitado; "deploy" já é nome de arquivo e vira "Deploy"
    const typedName = typedParts[typedParts.length - 1];
    const base = opts.template?.numbered ? `${nextNumber(namesIn(pages, folder))}-${name}` : name;
    const path = unique(folder ? `${folder}/${base}` : base);
    const section = folder ? (sectionOf(folder) ?? nameToTitle(folder.split('/').pop()!)) : undefined;
    return { path, title: typedName === name ? nameToTitle(name) : typedName, ...(section && { section }), ...template };
  }
  const sectionFolder = opts.section ? dirOfSection(pages, opts.section) : undefined;
  const folder = opts.template?.folder ?? sectionFolder ?? '';
  const name = fileNameFor(typed).replace(/\.md$/, '');
  const base = opts.template?.numbered ? `${nextNumber(namesIn(pages, folder))}-${name}` : name;
  const section = opts.section ?? (folder ? sectionOf(folder) : undefined);
  return { path: unique(folder ? `${folder}/${base}` : base), title: typed, ...(section && { section }), ...template };
}

const namesIn = (pages: { path: string }[], folder: string) =>
  pages.filter(p => (folder ? p.path.startsWith(`${folder}/`) && !p.path.slice(folder.length + 1).includes('/') : !p.path.includes('/'))).map(p => p.path.split('/').pop()!);

function dirOfSection(pages: { path: string; section?: string }[], section: string): string | undefined {
  const page = pages.find(p => p.section === section && p.path.includes('/'));
  return page?.path.split('/').slice(0, -1).join('/');
}

/** Seção nova: a página `pasta/index.md` com o nome da seção. */
export function newSectionPage(name: string, plan: Pick<SitePlan, 'nav'>): AddedPage | undefined {
  const typed = name.trim();
  if (!typed) return undefined;
  const taken = new Set(plan.nav.flatMap(e => (e.kind === 'page' ? [e.page.path] : e.pages.map(p => p.path))));
  const slug = fileNameFor(typed).replace(/\.md$/, '');
  let folder = slug;
  for (let i = 2; [...taken].some(p => p.startsWith(`${folder}/`)); i++) folder = `${slug}-${i}`;
  return { path: `${folder}/index.md`, title: typed, section: typed };
}

/**
 * Dono sugerido pelo CODEOWNERS: o primeiro dono da regra `*` (a que vale para o repositório todo), sem o `@` e
 * sem a organização (`@acme/time-pagamentos` → `time-pagamentos`). undefined sem regra `*`.
 */
/** Tamanho máximo da descrição tirada do README: uma ou duas frases, como as do catálogo do Backstage. */
const DESCRIPTION_MAX = 200;

/**
 * Descrição do componente pelo README: o 1º parágrafo de texto (pula títulos, selos, listas, código, citações, HTML e
 * tabelas), sem a formatação do Markdown. Comprido, corta no fim de uma frase, senão numa palavra. undefined se não há.
 */
export function readmeDescription(readme: string): string | undefined {
  const blocks = readme
    .replace(/\r\n?/g, '\n')
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '')
    .split(/\n\s*\n/)
    .map(block => block.trim());
  for (const block of blocks) {
    if (!block || /^([#>|<*+-]|\d+[.)]\s|={3,}|-{3,})/.test(block)) continue;
    const text = block
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[\s*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    if (text.length <= DESCRIPTION_MAX) return text;
    const head = text.slice(0, DESCRIPTION_MAX);
    const sentence = head.search(/[.!?](?=\s)[^.!?]*$/);
    if (sentence > 0) return head.slice(0, sentence + 1);
    return `${head.slice(0, head.lastIndexOf(' ')).trimEnd()}…`;
  }
  return undefined;
}

export function codeownersOwner(text: string): string | undefined {
  let owner: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const [pattern, first] = line.replace(/#.*/, '').trim().split(/\s+/);
    if ((pattern === '*' || pattern === '/*' || pattern === '/') && first) owner = first;
  }
  return owner?.replace(/^@/, '').split('/').pop() || undefined;
}
