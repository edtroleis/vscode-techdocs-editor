/**
 * "Conferir a documentação" da extensão (spec 03, "Vitrine no Backstage"), fora do VS Code: lê cada site do disco
 * do mesmo jeito que a extensão (mkdocs.yml, docs_dir, regras do markdownlint, catalog-info.yaml) e roda o
 * `checkSite` e o lint do core, que são o que a extensão mostra na árvore, no Conferir e no painel Problemas.
 *
 * Uso: node <bundle> <entrada.json> <saída.json>; a entrada é [{ name, repo, site }] (diretórios absolutos: a raiz
 * do repositório e a pasta do mkdocs.yml).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { DEFAULT_LINT_CONFIG, LINT_CONFIG_FILES, lintFindings, parseLintConfig } from '../../packages/core/src/lint';
import { docsDirFromMkdocs } from '../../packages/core/src/mkdocs';
import { checkSite, type SiteSnapshot } from '../../packages/core/src/siteCheck';

type Input = { name: string; repo: string; site: string };

const slash = (path: string) => path.split('\\').join('/');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

/** O arquivo de regras do lint mais perto do site, subindo até a raiz do repositório (como a extensão). */
function lintConfigFor(site: string, repo: string) {
  for (let dir = site; ; dir = dirname(dir)) {
    for (const name of LINT_CONFIG_FILES) {
      const path = join(dir, name);
      if (existsSync(path)) return { file: slash(relative(repo, path)), config: parseLintConfig(name, readFileSync(path, 'utf8')) };
    }
    if (dir === repo || dirname(dir) === dir) return undefined;
  }
}

function snapshot({ repo, site }: Input): SiteSnapshot {
  const root = slash(relative(repo, site));
  const mkdocsFile = existsSync(join(site, 'mkdocs.yml')) ? 'mkdocs.yml' : 'mkdocs.yaml';
  const mkdocsYml = readFileSync(join(site, mkdocsFile), 'utf8');
  const docsDirLocal = docsDirFromMkdocs(mkdocsYml);
  const docsPath = join(site, docsDirLocal);
  const docsDirExists = existsSync(docsPath);
  const all = docsDirExists ? files(docsPath).map(p => slash(relative(docsPath, p))) : [];
  const pages = Object.fromEntries(all.filter(p => p.endsWith('.md')).map(p => [p, readFileSync(join(docsPath, p), 'utf8')]));
  const lint = lintConfigFor(site, repo);
  const catalogPath = [join(site, 'catalog-info.yaml'), join(repo, 'catalog-info.yaml')].find(existsSync);
  return {
    root,
    mkdocsFile: root ? `${root}/${mkdocsFile}` : mkdocsFile,
    mkdocsYml,
    docsDir: slash(relative(repo, docsPath)),
    docsDirExists,
    files: all,
    pages,
    lintConfigFile: lint?.file,
    lintConfig: lint?.config ?? DEFAULT_LINT_CONFIG,
    catalog: catalogPath ? { file: slash(relative(repo, catalogPath)), text: readFileSync(catalogPath, 'utf8') } : undefined,
    catalogMode: 'auto',
    backstageSignal: true,
    repository: { name: basename(repo) },
  };
}

const [inputPath, outputPath] = process.argv.slice(2);
const input = JSON.parse(readFileSync(inputPath, 'utf8')) as Input[];
const output = input.map(entry => {
  try {
    const site = snapshot(entry);
    const findings = checkSite(site).map(({ fix, ...f }) => ({ ...f, fixable: Boolean(fix) }));
    const lint = Object.entries(site.pages).flatMap(([page, text]) =>
      lintFindings(text, site.lintConfig ?? DEFAULT_LINT_CONFIG).map(p => ({ page, line: p.line, rule: p.rule, message: p.message, fixable: p.fixable })),
    );
    return { ...entry, docsDir: join(entry.site, docsDirFromMkdocs(site.mkdocsYml)), pages: Object.keys(site.pages).length, findings, lint };
  } catch (error) {
    return { ...entry, failure: String((error as Error).message ?? error) };
  }
});
writeFileSync(outputPath, JSON.stringify(output, null, 1));
