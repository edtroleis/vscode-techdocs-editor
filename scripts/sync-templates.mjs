#!/usr/bin/env node
// Traz os templates e os exemplos do repositório de templates (spec 08, TR3), numa tag fixada, para dentro do
// pacote: packages/core/src/templatesBundle.generated.ts. A extensão usa essa cópia, sem rede.
//
// Uso:
//   npm run sync-templates -- v1.1.0     troca a tag e gera de novo
//   npm run sync-templates               gera de novo na tag atual
//   npm run sync-templates -- --check    confere que a cópia bate com a tag (falha se alguém editou à mão)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const REPOSITORY = 'https://github.com/edtroleis/techdocs-templates';
// Para testar mudanças antes da tag: TEMPLATES_REPOSITORY=~/code/techdocs-templates npm run sync-templates -- main
const CLONE_FROM = process.env.TEMPLATES_REPOSITORY || REPOSITORY;
const OUTPUT = new URL('../packages/core/src/templatesBundle.generated.ts', import.meta.url);
const INCLUDE = /^(templates|examples)\/.+\.(md|ya?ml)$/;

const args = process.argv.slice(2);
const check = args.includes('--check');
const currentRef = () => /ref: '([^']+)'/.exec(readFileSync(OUTPUT, 'utf8'))?.[1];
const ref = args.find(a => !a.startsWith('--')) ?? currentRef();
if (!ref) {
  console.error('Diga a tag: npm run sync-templates -- v1.0.0');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'techdocs-templates-'));
try {
  execFileSync('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', ref, CLONE_FROM, dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
  const files = {};
  const walk = folder => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const rel = relative(dir, path).split('\\').join('/');
        if (INCLUDE.test(rel)) files[rel] = readFileSync(path, 'utf8');
      }
    }
  };
  for (const top of ['templates', 'examples']) walk(join(dir, top));
  const body = `// Gerado por scripts/sync-templates.mjs a partir de ${REPOSITORY} (spec 08, TR3). Não editar à mão:
// mude o repositório de templates, marque uma tag e rode \`npm run sync-templates -- <tag>\`.

/** De onde veio a cópia dos templates e dos exemplos. */
export const TEMPLATES_SOURCE = { repository: '${REPOSITORY}', ref: '${ref}', commit: '${commit}' };

/** Os arquivos de \`templates/\` e \`examples/\` do repositório, pelo caminho. */
export const TEMPLATES_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)};
`;
  if (check) {
    if (readFileSync(OUTPUT, 'utf8') !== body) {
      // exitCode, não exit(): o finally apaga o clone temporário
      console.error(`A cópia dos templates não bate com ${ref}: rode npm run sync-templates`);
      process.exitCode = 1;
    } else console.log(`Templates iguais a ${ref} (${commit.slice(0, 7)}), ${Object.keys(files).length} arquivos`);
  } else {
    writeFileSync(OUTPUT, body);
    console.log(`Templates de ${ref} (${commit.slice(0, 7)}): ${Object.keys(files).length} arquivos`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
