import { docsDirFromMkdocs } from '@edtroleis/techdocs-editor-core';

/**
 * Um site do MkDocs no workspace: a pasta do `mkdocs.yml` e a pasta das páginas (`docs_dir`), como
 * caminhos de URI (`/` como separador, sem barra no fim).
 */
export type DocsSite = { root: string; docsDir: string };

/** Site a partir do caminho do `mkdocs.yml` e do conteúdo dele. */
export function siteFromMkdocs(mkdocsPath: string, mkdocsYml: string): DocsSite {
  const root = mkdocsPath.replace(/\/[^/]*$/, '');
  const docsDir = docsDirFromMkdocs(mkdocsYml).replace(/^\.?\/+|\/+$/g, '');
  return { root, docsDir: `${root}/${docsDir}` };
}

/**
 * Site de que a página faz parte (o `.md` está dentro do `docs_dir` dele). Com sites aninhados, vale
 * o mais interno, como no MkDocs rodado na pasta mais próxima.
 */
export function siteOf(pagePath: string, sites: readonly DocsSite[]): DocsSite | undefined {
  if (!/\.md$/i.test(pagePath)) return undefined;
  return sites
    .filter(site => pagePath.startsWith(`${site.docsDir}/`))
    .sort((a, b) => b.docsDir.length - a.docsDir.length)[0];
}

/**
 * O arquivo tem marcadores de conflito do Git (`<<<<<<<`, `=======`, `>>>>>>>`, na ordem, no começo
 * da linha). Dentro de bloco de código também conta: o editor visual não deve abrir até resolver.
 */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7}(?: .*)?\r?\n[\s\S]*?^={7}\r?\n[\s\S]*?^>{7}(?: .*)?$/m.test(text);
}

/** Pastas que nunca têm documentação de verdade: dependências, saídas de build, fixtures de teste. */
const IGNORED_FOLDERS = new Set(['node_modules', 'site', 'out', 'dist', 'build']);
/** `fixtures`, `__fixtures__`, `wiki-fixture`… */
const FIXTURE = /(^|[-_])fixtures?(__)?$/;

/**
 * `mkdocs.yml` que não é um site para editar: numa pasta oculta (`.git`, `.claude/worktrees`, `.vscode-test`…)
 * ou ignorada, ou esqueleto de template (`${{ values.x }}` do Backstage, `{{ cookiecutter.x }}`).
 * `path`: relativo ao workspace.
 */
export function isIgnoredMkdocs(path: string, text: string): boolean {
  const folders = path.split('/').slice(0, -1);
  if (folders.some(f => f.startsWith('.') || IGNORED_FOLDERS.has(f) || FIXTURE.test(f))) return true;
  return /\$\{\{|\{\{\s*cookiecutter\./.test(text);
}

/** Com mais sites que isso e nada escolhido, a árvore sugere escolher quais mostrar. */
export const CHOOSE_SITES_THRESHOLD = 5;

/**
 * O site (pasta do `mkdocs.yml`, relativa ao workspace; `.` na raiz) está entre os escolhidos em
 * `techdocsEditor.sites`: a própria pasta ou uma pasta acima dela. Sem escolha (ou lista vazia), todos.
 */
export function isShownSite(path: string, chosen: readonly string[] | null | undefined): boolean {
  if (!chosen?.length) return true;
  return chosen.some(entry => {
    const folder = entry.replace(/^\.\/+/, '').replace(/\/+$/, '');
    return !folder || folder === '.' || path === folder || path.startsWith(`${folder}/`);
  });
}
