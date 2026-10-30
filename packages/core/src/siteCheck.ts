import type { Configuration } from 'markdownlint';
import { isMap, isScalar, isSeq, parseAllDocuments, parseDocument, YAMLMap, YAMLSeq } from 'yaml';
import { addToNav, docsTree, DocsNode, nameToTitle, pageTitle, siteName } from './docsTree';
import { fixLintProblems, lintMarkdown, LINT_CONFIG_FILES } from './lint';
import type { CatalogMode } from './repoConfig';
import { SETUP_MARKDOWNLINT } from './setup';
import { TECHDOCS_REF, techdocsRefAnnotation } from './siteTemplates';

/**
 * Conferência da documentação de um repositório (spec 04, T3b): o que falta ou está errado num site do MkDocs,
 * cada achado com a correção, quando há uma. Sem `vscode` e sem disco: quem chama monta o retrato do site, para o
 * modo local, o remoto e o plugin usarem a mesma lógica.
 */

export type SiteFindingCode =
  | 'site-name-missing'
  | 'techdocs-plugin-missing'
  | 'docs-dir-missing'
  | 'index-missing'
  | 'nav-page-missing'
  | 'page-not-in-nav'
  | 'catalog-missing'
  | 'catalog-ref-missing'
  | 'lint-config-missing'
  | 'lint-problems'
  | 'broken-link'
  | 'missing-image';

/** `hint`: só uma dica (ex.: sem `catalog-info.yaml` no modo `auto`); não conta como item a revisar. */
export type SiteFindingSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * Correção de um achado: o arquivo (relativo à raiz do repositório) e o texto novo a partir do atual (undefined:
 * o arquivo não existe). Devolver o mesmo texto é "nada a fazer" (outra correção já resolveu).
 */
export type SiteFix = { file: string; apply: (current: string | undefined) => string };

export type SiteFinding = {
  code: SiteFindingCode;
  severity: SiteFindingSeverity;
  /** Arquivo do achado, relativo à raiz do repositório (o `mkdocs.yml` quando o problema é algo que falta). */
  file: string;
  /** Linha (a partir de 1), quando o achado é um trecho do arquivo. */
  line?: number;
  /** O que o achado aponta: a página, o link, a imagem, o arquivo que falta ou o total de problemas do lint. */
  target?: string;
  fix?: SiteFix;
};

/** Retrato de um site do MkDocs. Caminhos relativos à raiz do repositório, com `/`. */
export type SiteSnapshot = {
  /** Pasta do `mkdocs.yml` (`''` na raiz). */
  root: string;
  mkdocsFile: string;
  mkdocsYml: string;
  /** `docs_dir` (ex.: `docs` ou `svc/docs`). */
  docsDir: string;
  docsDirExists: boolean;
  /** Todos os arquivos do `docs_dir`, relativos a ele. */
  files: string[];
  /** Texto de cada página (`.md`) do `docs_dir`, pelo caminho relativo a ele. */
  pages: Record<string, string>;
  /** Arquivo de regras do lint achado da pasta do site até a raiz do repositório (undefined: nenhum). */
  lintConfigFile?: string;
  /** Configuração do lint para as páginas (undefined: não conferir o lint, ex.: workspace não confiável). */
  lintConfig?: Configuration;
  /** O `catalog-info.yaml` da pasta do site ou da raiz do repositório. */
  catalog?: { file: string; text: string };
  /** O `catalog-info.yaml` na conferência (padrão `auto`, ver `CatalogMode`). */
  catalogMode?: CatalogMode;
  /**
   * Há outro `catalog-info.yaml` no workspace: sinal de que o Backstage é usado. Sem ele (`false`), o modo `auto` não
   * fala do arquivo que falta; undefined conta como sinal.
   */
  backstageSignal?: boolean;
  /** Nome da pasta do repositório e o dono, para o `catalog-info.yaml` novo no modo `required`. */
  repository?: { name: string; owner?: string };
};

const SEVERITY_ORDER: SiteFindingSeverity[] = ['error', 'warning', 'info', 'hint'];
const join = (dir: string, path: string) => (dir ? `${dir}/${path}` : path);
const isUrl = (path: string) => /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//');

/** Todos os achados do site, os erros primeiro. */
export function checkSite(site: SiteSnapshot): SiteFinding[] {
  const findings: SiteFinding[] = [];
  const add = (finding: SiteFinding) => findings.push(finding);
  const name = siteName(site.mkdocsYml);
  const title = name ?? (nameToTitle(site.root.split('/').pop() || '') || 'Documentation');

  if (!name) add({ code: 'site-name-missing', severity: 'error', file: site.mkdocsFile, fix: { file: site.mkdocsFile, apply: yml => addSiteName(yml ?? '', title) } });
  if (!hasTechdocsPlugin(site.mkdocsYml)) {
    add({ code: 'techdocs-plugin-missing', severity: 'error', file: site.mkdocsFile, line: lineOf(site.mkdocsYml, /^plugins\s*:/m), fix: { file: site.mkdocsFile, apply: yml => addTechdocsPlugin(yml ?? '') } });
  }

  const indexFile = join(site.docsDir, 'index.md');
  const createIndex: SiteFix = { file: indexFile, apply: text => text ?? `# ${title}\n` };
  if (!site.docsDirExists) {
    add({ code: 'docs-dir-missing', severity: 'error', file: site.mkdocsFile, target: site.docsDir, fix: createIndex });
  } else {
    checkPages(site, title, createIndex, add);
  }

  const catalogMode = site.catalogMode ?? 'auto';
  if (catalogMode === 'off') {
    // O Backstage registra a documentação de outro jeito: nada sobre o catalog-info.yaml
  } else if (!site.catalog && catalogMode === 'required') {
    const file = 'catalog-info.yaml';
    const skeleton = catalogInfoSkeleton({
      name: site.repository?.name || site.root.split('/').pop() || title,
      owner: site.repository?.owner,
      annotation: techdocsRefAnnotation('', site.root),
    });
    add({ code: 'catalog-missing', severity: 'warning', file: site.mkdocsFile, target: file, fix: { file, apply: text => text ?? skeleton } });
  } else if (!site.catalog) {
    // Modo auto: só uma dica, e só se o workspace tem sinal de Backstage (a extensão não depende dele)
    if (site.backstageSignal !== false) add({ code: 'catalog-missing', severity: 'hint', file: site.mkdocsFile, target: 'catalog-info.yaml' });
  } else if (!hasRef(site.catalog.text)) {
    const catalogDir = site.catalog.file.split('/').slice(0, -1).join('/');
    const annotation = techdocsRefAnnotation(catalogDir, site.root);
    add({
      code: 'catalog-ref-missing',
      severity: 'warning',
      file: site.catalog.file,
      line: lineOf(site.catalog.text, /^metadata\s*:/m),
      target: annotation,
      fix: { file: site.catalog.file, apply: text => addAnnotation(text ?? '', annotation) },
    });
  }
  if (!site.lintConfigFile) {
    const file = LINT_CONFIG_FILES[2];
    add({ code: 'lint-config-missing', severity: 'info', file: site.mkdocsFile, target: file, fix: { file, apply: text => text ?? SETUP_MARKDOWNLINT } });
  }
  return findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function checkPages(site: SiteSnapshot, title: string, createIndex: SiteFix, add: (finding: SiteFinding) => void) {
  const pages = Object.keys(site.pages).sort();
  if (!site.files.some(f => /^(index|readme)\.md$/i.test(f))) {
    add({ code: 'index-missing', severity: 'warning', file: site.mkdocsFile, target: 'index.md', fix: createIndex });
  }

  // nav: a página que não existe vira uma página com o título do nav; a que falta no nav entra nele
  const tree = docsTree(site.mkdocsYml, pages, path => (site.pages[path] === undefined ? undefined : pageTitle(site.pages[path])));
  for (const node of flatten(tree.nodes)) {
    if (node.kind !== 'page' || !node.missing) continue;
    const file = join(site.docsDir, node.path);
    add({
      code: 'nav-page-missing',
      severity: 'error',
      file: site.mkdocsFile,
      line: lineOf(site.mkdocsYml, new RegExp(`[\\s:'"]${escape(node.path)}['"]?\\s*(#.*)?$`, 'm')),
      target: node.path,
      fix: { file, apply: text => text ?? `# ${node.title}\n` },
    });
  }
  for (const node of tree.notInNav) {
    if (node.kind !== 'page') continue;
    const canAdd = addToNav(site.mkdocsYml, node.path, node.title) !== undefined;
    add({
      code: 'page-not-in-nav',
      severity: 'warning',
      file: join(site.docsDir, node.path),
      target: node.path,
      ...(canAdd && { fix: { file: site.mkdocsFile, apply: (yml: string | undefined) => addToNav(yml ?? '', node.path, node.title)?.yml ?? yml ?? '' } }),
    });
  }

  const files = new Set(site.files);
  for (const path of pages) {
    const text = site.pages[path];
    const file = join(site.docsDir, path);
    for (const ref of pageRefs(text)) {
      const target = resolveRef(path, ref.target);
      const folder = target?.replace(/\/$/, '');
      const found = target !== undefined && (!folder || files.has(target) || site.files.some(f => f.startsWith(`${folder}/`)));
      if (!found) add({ code: ref.image ? 'missing-image' : 'broken-link', severity: 'error', file, line: ref.line, target: ref.target });
    }
    if (site.lintConfig) {
      const problems = lintMarkdown(text.replace(/\r\n/g, '\n'), site.lintConfig);
      if (problems.length) {
        const config = site.lintConfig;
        add({
          code: 'lint-problems',
          severity: 'warning',
          file,
          line: problems[0].line,
          target: String(problems.length),
          ...(problems.some(p => p.fixable) && { fix: { file, apply: (current: string | undefined) => (current === undefined ? '' : fixLintProblems(current, config)) } }),
        });
      }
    }
  }
}

const flatten = (nodes: DocsNode[]): DocsNode[] => nodes.flatMap(n => (n.kind === 'section' ? flatten(n.children) : [n]));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Linha (a partir de 1) do primeiro trecho que casa, ou undefined. */
/** Nome de entidade do Backstage: minúsculas, letras, números e `-`, até 63 caracteres. */
function entityName(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return clean || 'documentation';
}

/**
 * `catalog-info.yaml` mínimo de um componente com a documentação no TechDocs (modo `required`). `annotation`:
 * `backstage.io/techdocs-ref: dir:…`, de `techdocsRefAnnotation`.
 */
export function catalogInfoSkeleton(opts: { name: string; owner?: string; annotation: string; title?: string; description?: string }): string {
  const owner = opts.owner?.trim();
  const title = opts.title?.trim();
  const description = opts.description?.trim();
  return [
    'apiVersion: backstage.io/v1alpha1',
    'kind: Component',
    'metadata:',
    `  name: ${entityName(opts.name)}`,
    // Sem título e descrição, o Backstage mostra o name (tarefas-api) e uma linha vazia na lista das docs
    ...(title ? [`  title: ${yamlString(title)}`] : []),
    ...(description ? [`  description: ${yamlString(description)}`] : []),
    '  annotations:',
    `    ${opts.annotation}`,
    'spec:',
    '  type: service',
    `  owner: ${owner ? (/^[\w.:/-]+$/.test(owner) ? owner : JSON.stringify(owner)) : 'unknown # the team that owns this component'}`,
    '  lifecycle: production',
    '',
  ].join('\n');
}

/** Texto de uma linha no YAML: sem aspas quando não precisa, senão entre aspas (JSON é YAML válido). */
const yamlString = (text: string) => (/^[\p{L}\p{N}][\p{L}\p{N} ,.()/-]*$/u.test(text) ? text : JSON.stringify(text));

function lineOf(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match ? text.slice(0, match.index + (match[0].startsWith('\n') ? 1 : 0)).split('\n').length : undefined;
}

/** Links e imagens de uma página (inline e por referência), fora de blocos e trechos de código. */
export function pageRefs(markdown: string): { target: string; image: boolean; line: number }[] {
  const refs: { target: string; image: boolean; line: number }[] = [];
  let fence: string | undefined;
  markdown.split(/\r?\n/).forEach((raw, i) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? undefined : marker;
      return;
    }
    if (fence || /^( {4}|\t)/.test(raw)) return;
    const line = raw.replace(/(`+)[\s\S]*?\1/g, '');
    for (const m of line.matchAll(/(!?)\[(?:[^\]]|\][^(])*?\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+["'(][^)]*)?\)/g)) {
      refs.push({ target: m[2] ?? m[3], image: m[1] === '!', line: i + 1 });
    }
    const definition = /^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/.exec(line);
    if (definition) refs.push({ target: definition[1], image: false, line: i + 1 });
  });
  return refs.filter(ref => !isUrl(ref.target) && !ref.target.startsWith('#') && !ref.target.startsWith('/'));
}

/**
 * Arquivo do `docs_dir` para onde o link aponta, a partir da página (sem `#âncora` e `?consulta`); undefined se
 * o link sai do `docs_dir`.
 */
function resolveRef(page: string, target: string): string | undefined {
  const clean = decodeURIComponent(target.replace(/[#?].*$/, ''));
  const parts = page.split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else if (part && part !== '.') {
      parts.push(part);
    }
  }
  return parts.join('/') + (clean.endsWith('/') && parts.length ? '/' : '');
}

function hasTechdocsPlugin(yml: string): boolean {
  const plugins = parseDocument(yml).get('plugins', true);
  if (!isSeq(plugins)) return false;
  return plugins.items.some(item => (isScalar(item) ? item.value === 'techdocs-core' : isMap(item) && item.has('techdocs-core')));
}

/** `site_name` na primeira linha (depois de comentários do topo), sem mexer no resto. */
function addSiteName(yml: string, name: string): string {
  const doc = parseDocument(yml);
  if (isMap(doc.contents) && doc.contents.has('site_name')) {
    doc.set('site_name', name);
    return doc.toString();
  }
  const quoted = /^[\w À-ÿ.-]+$/.test(name) && !/^\s|\s$/.test(name) ? name : JSON.stringify(name);
  const head = /^(?:#.*\r?\n|\s*\r?\n)*/.exec(yml)?.[0] ?? '';
  return `${head}site_name: ${quoted}\n${yml.slice(head.length)}`;
}

/** `techdocs-core` como primeiro item de `plugins`: uma linha a mais, ou a chave nova no fim. */
function addTechdocsPlugin(yml: string): string {
  if (hasTechdocsPlugin(yml)) return yml;
  const doc = parseDocument(yml);
  const plugins = doc.get('plugins', true);
  if (isSeq(plugins) && !plugins.flow && plugins.items.length && plugins.range) {
    const first = plugins.items[0] as { range?: [number, number, number] };
    const start = first.range ? yml.lastIndexOf('\n', first.range[0]) + 1 : plugins.range[0];
    const indent = /^[ \t]*-?[ \t]*/.exec(yml.slice(start))?.[0] ?? '  - ';
    return `${yml.slice(0, start)}${indent}techdocs-core\n${yml.slice(start)}`;
  }
  if (isSeq(plugins)) {
    (plugins as YAMLSeq).items.unshift(doc.createNode('techdocs-core') as never);
    return doc.toString();
  }
  if (isMap(doc.contents) && doc.contents.has('plugins')) {
    doc.set('plugins', ['techdocs-core']);
    return doc.toString();
  }
  return `${yml}${yml && !yml.endsWith('\n') ? '\n' : ''}plugins:\n  - techdocs-core\n`;
}

const hasRef = (catalog: string) =>
  parseAllDocuments(catalog).some(doc => {
    const value = !('errors' in doc && doc.errors.length) ? doc.getIn(['metadata', 'annotations', TECHDOCS_REF], true) : undefined;
    return isScalar(value) && typeof value.value === 'string' && value.value.trim() !== '';
  });

/**
 * A anotação em `metadata.annotations` do componente (o documento `kind: Component`, senão o primeiro): uma
 * linha a mais (com `annotations:` se faltar), sem mexer no resto do arquivo.
 */
function addAnnotation(catalog: string, annotation: string): string {
  if (hasRef(catalog)) return catalog;
  const docs = parseAllDocuments(catalog).filter(doc => !('errors' in doc && doc.errors.length) && isMap(doc.contents));
  const doc = docs.find(d => d.get('kind') === 'Component') ?? docs[0];
  const metadata = doc?.get('metadata', true);
  if (!doc || !isMap(metadata) || metadata.flow || !metadata.items.length) return catalog;
  const lineStart = (offset: number) => catalog.lastIndexOf('\n', offset) + 1;
  const indentAt = (offset: number) => /^[ \t]*/.exec(catalog.slice(lineStart(offset)))![0];
  const annotations = metadata.get('annotations', true);
  if (isMap(annotations) && !annotations.flow && annotations.items.length) {
    const key = (annotations as YAMLMap).items[0].key as { range?: [number, number, number] };
    if (!key.range) return catalog;
    const start = lineStart(key.range[0]);
    return `${catalog.slice(0, start)}${indentAt(key.range[0])}${annotation}\n${catalog.slice(start)}`;
  }
  if (annotations !== undefined) return catalog;
  const key = metadata.items[0].key as { range?: [number, number, number] };
  if (!key.range) return catalog;
  const indent = indentAt(key.range[0]);
  const start = lineStart(key.range[0]);
  return `${catalog.slice(0, start)}${indent}annotations:\n${indent}  ${annotation}\n${catalog.slice(start)}`;
}
