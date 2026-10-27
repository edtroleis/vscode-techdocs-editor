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
