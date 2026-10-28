import { isMap, isScalar, parseDocument, stringify } from 'yaml';
import { docsTree, DocsNode } from './docsTree';
import { relativePath } from './mkdocs';
import { fillTemplate, pagePath, parseFields, TemplateField, usedFields } from './templates';

/**
 * Um arquivo do site (TP11): o caminho no `docs_dir`, o título (no `nav` e no `{{title}}` da página) e de onde
 * vem o texto: um template de página (`page`, pelo id, o do repositório antes do da extensão) ou um arquivo da
 * pasta do template (`source`).
 */
export type SiteTemplateFile = { path: string; title: string; page?: string; source?: string; section?: string };

export type SiteTemplate = {
  /** Nome da pasta do template. */
  id: string;
  name: string;
  description: string;
  version: number;
  fields: TemplateField[];
  /** Gera o `nav` no `mkdocs.yml` (padrão); sem ele, o MkDocs monta o menu pelas pastas. */
  nav: boolean;
  /** Outras chaves do `mkdocs.yml` (ex.: `markdown_extensions`), além de `site_name`, `nav` e `plugins`. */
  mkdocs: Record<string, unknown>;
  files: SiteTemplateFile[];
};

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : value == null ? fallback : String(value));

/** Caminho relativo sem `..`, sem barra no começo e sem letra de unidade. */
const safePath = (path: string) => (pagePath('', path) && !/^[\\/]/.test(path) && !/^[A-Za-z]:/.test(path) ? path : undefined);

/**
 * Lê o `template.yml` de um template de site. undefined se não é um (sem `name` ou sem arquivos válidos): numa
 * pasta de templates, outra pasta qualquer não vira opção. Arquivo com caminho fora do `docs_dir`, sem título ou
 * sem `page`/`source` é ignorado.
 */
export function parseSiteTemplate(id: string, yml: string): SiteTemplate | undefined {
  const doc = parseDocument(yml);
  if (doc.errors.length || !isMap(doc.contents)) return undefined;
  const info = doc.toJSON() as Record<string, unknown>;
  if (typeof info.name !== 'string' || !Array.isArray(info.files)) return undefined;
  const files = info.files.flatMap((value): SiteTemplateFile[] => {
    if (!value || typeof value !== 'object') return [];
    const file = value as Record<string, unknown>;
    const path = typeof file.path === 'string' ? safePath(file.path.trim()) : undefined;
    const title = text(file.title).trim();
    const page = typeof file.page === 'string' && file.page.trim() ? file.page.trim() : undefined;
    const source = typeof file.source === 'string' ? safePath(file.source.trim()) : undefined;
    if (!path || !title || (!page && !source)) return [];
    const section = typeof file.section === 'string' && file.section.trim() ? file.section.trim() : undefined;
    return [{ path, title, ...(page ? { page } : { source }), ...(section && { section }) }];
  });
  if (!files.length) return undefined;
  const mkdocs = info.mkdocs && typeof info.mkdocs === 'object' && !Array.isArray(info.mkdocs) ? (info.mkdocs as Record<string, unknown>) : {};
  return {
    id,
    name: info.name,
    description: text(info.description),
    version: typeof info.version === 'number' ? info.version : 1,
    fields: parseFields(info.fields),
    nav: info.nav !== false,
    mkdocs,
    files,
  };
}

/** Uma página do site pronta: caminho no `docs_dir`, título e texto com os campos preenchidos. */
export type SitePage = { path: string; title: string; section?: string; content: string };

/**
 * Texto de cada arquivo, antes dos campos: o corpo do template de página (sem o bloco `template:`) ou o arquivo
 * da pasta do template. undefined se não existe.
 */
export type SiteSources = (file: SiteTemplateFile) => string | undefined;

/** Campos usados pelo site (títulos e textos), na ordem: os do template de site, depois os das páginas. */
export function siteUsedFields(template: SiteTemplate, sources: SiteSources): string[] {
  return [...new Set(template.files.flatMap(file => [...usedFields(file.title), ...usedFields(sources(file) ?? '')]))];
}

/**
 * As páginas do site, com os campos preenchidos; cada página tem o próprio título em `{{title}}`. Lança erro com
 * o arquivo que falta, se um `page` ou `source` não existe.
 */
export function buildSitePages(template: SiteTemplate, sources: SiteSources, values: Record<string, string>): SitePage[] {
  return template.files.map(file => {
    const body = sources(file);
    if (body === undefined) throw new Error(file.page ? `page template "${file.page}"` : `file "${file.source}"`);
    const title = fillTemplate(file.title, values);
    return { path: file.path, title, ...(file.section && { section: file.section }), content: fillTemplate(body, { ...values, title }) };
  });
}

/**
 * O `mkdocs.yml` do site novo: `site_name`, o `nav` (as páginas na ordem do template, as de uma `section`
 * juntas onde a seção aparece primeiro), o plugin `techdocs-core` e as outras chaves do template.
 */
export function siteMkdocsYml(siteName: string, pages: SitePage[], template: Pick<SiteTemplate, 'nav' | 'mkdocs'>): string {
  const { site_name: _name, nav: _nav, plugins, ...extra } = template.mkdocs;
  const config: Record<string, unknown> = { site_name: siteName };
  if (template.nav) {
    const nav: Record<string, unknown>[] = [];
    const sections = new Map<string, Record<string, string>[]>();
    for (const page of pages) {
      const entry = { [page.title]: page.path };
      if (!page.section) {
        nav.push(entry);
      } else if (sections.has(page.section)) {
        sections.get(page.section)!.push(entry);
      } else {
        sections.set(page.section, [entry]);
        nav.push({ [page.section]: sections.get(page.section) });
      }
    }
    config.nav = nav;
  }
  const pluginList = Array.isArray(plugins) ? plugins : [];
  const hasTechdocs = pluginList.some(p => p === 'techdocs-core' || (p && typeof p === 'object' && 'techdocs-core' in p));
  config.plugins = hasTechdocs ? pluginList : ['techdocs-core', ...pluginList];
  return stringify({ ...config, ...extra }, { lineWidth: 0 });
}

/**
 * `mkdocs.yml` de um site adotado (0.4.0): as páginas que já existem no `docs_dir`, no `nav` na ordem da árvore sem
 * `nav` (pastas viram seções, `index.md` primeiro, títulos pelo título 1 de cada página), e o plugin `techdocs-core`.
 * Nenhuma página muda.
 */
export function adoptedMkdocsYml(siteName: string, pages: readonly string[], titleOf: (path: string) => string | undefined): string {
  const toNav = (nodes: DocsNode[]): Record<string, unknown>[] =>
    nodes.map(node =>
      node.kind === 'section' ? { [node.title]: toNav(node.children) } : { [node.title]: node.kind === 'page' ? node.path : node.url },
    );
  return stringify({ site_name: siteName, nav: toNav(docsTree(undefined, pages, titleOf).nodes), plugins: ['techdocs-core'] }, { lineWidth: 0 });
}

/** Anotação que o TechDocs lê no `catalog-info.yaml`. */
export const TECHDOCS_REF = 'backstage.io/techdocs-ref';

/**
 * A anotação para o `catalog-info.yaml` que fica em `catalogDir`, apontando para o site em `siteRoot` (os dois
 * relativos à raiz do repositório): `backstage.io/techdocs-ref: dir:.` na mesma pasta.
 */
export function techdocsRefAnnotation(catalogDir: string, siteRoot: string): string {
  const path = siteRoot.replace(/\/+$/, '') === catalogDir.replace(/\/+$/, '') ? '' : relativePath(catalogDir, `${siteRoot}/x`).replace(/\/?x$/, '');
  return `${TECHDOCS_REF}: dir:${path ? (path.startsWith('..') ? path : `./${path}`) : '.'}`;
}

/** O `catalog-info.yaml` já tem a anotação do TechDocs (em algum dos documentos). */
export function hasTechdocsRef(catalogInfo: string): boolean {
  return catalogInfo.split(/^---\s*$/m).some(part => {
    const value = parseDocument(part).getIn(['metadata', 'annotations', TECHDOCS_REF], true);
    return isScalar(value) && typeof value.value === 'string' && value.value.trim() !== '';
  });
}
