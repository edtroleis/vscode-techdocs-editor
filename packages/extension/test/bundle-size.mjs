// Tamanho do webview (spec 00, R3): o que carrega ao abrir o editor visual, no build de produção, fica
// dentro do orçamento; o KaTeX não entra; as linguagens dos blocos de código ficam em pedaços à parte.
// Uso: npm run test:bundle (refaz o build normal no fim).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Orçamento do que carrega na abertura (gzip). Hoje: ~446 KB; era 969 KB num arquivo só. */
const BUDGET_GZIP_KB = 500;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'dist', 'webview');
const build = (...args) => execFileSync(process.execPath, ['build.mjs', ...args], { cwd: root, stdio: 'ignore' });

const failures = [];
build('--production');
try {
  // O módulo principal e o que ele importa direto (os `import()` das linguagens ficam de fora)
  const loaded = new Set();
  const queue = ['main.js'];
  let bytes = 0;
  let gzip = 0;
  while (queue.length) {
    const file = queue.pop();
    if (loaded.has(file)) continue;
    loaded.add(file);
    const content = readFileSync(join(dir, file));
    bytes += content.length;
    gzip += gzipSync(content).length;
    const base = dirname(file);
    for (const [, path] of content.toString().matchAll(/from"\.\/([^"]+)"/g)) queue.push(join(base, path));
    if (/katex-display|KaTeX parse error/.test(content.toString())) failures.push(`KaTeX no bundle: ${file}`);
  }
  const kb = n => `${Math.round(n / 1024)} KB`;
  console.log(`webview na abertura: ${loaded.size} arquivos, ${kb(bytes)} (${kb(gzip)} gzip); orçamento ${BUDGET_GZIP_KB} KB gzip`);
  if (gzip / 1024 > BUDGET_GZIP_KB) failures.push(`passou do orçamento: ${kb(gzip)} gzip`);

  const chunks = readdirSync(join(dir, 'chunks'));
  if (!chunks.some(name => /^python-.*\.js$/.test(name))) failures.push('a linguagem Python não está num pedaço à parte');
  if (loaded.has(join('chunks', chunks.find(name => /^python-.*\.js$/.test(name)) ?? '-'))) {
    failures.push('o pedaço do Python carrega na abertura');
  }
} finally {
  build();
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
