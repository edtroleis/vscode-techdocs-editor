// Relatório de ida e volta com o editor de verdade (bundle do webview no Chromium), como o
// scripts/roundtrip-check.mjs da demo. Uso: npm run roundtrip -- <pasta-com-md> [...]
import { chromium } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// O pacote da extensão servido em http://webview.test (módulos ES não carregam de file://)
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const harness = 'http://webview.test/test/webview/harness.html';
/** Os textos que o host manda no `init` (os mesmos de LABELS em webview.ts). */
const LABELS = {
  problemsOne: '1 formatting problem',
  problemsOther: '{0} formatting problems',
  fixAll: 'Fix automatically',
  line: 'Line {0}',
  showLine: 'Show line {0} in the Markdown text',
};
const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('uso: npm run roundtrip -- <pasta-com-md> [...]');
  process.exit(2);
}

const files = dir =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.md') ? [path] : [];
  });

/** Primeira linha diferente, para o relatório. */
function firstDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  const i = x.findIndex((line, n) => line !== y[n]);
  const n = i === -1 ? x.length : i;
  return `linha ${n + 1}: ${JSON.stringify(x[n] ?? '')} → ${JSON.stringify(y[n] ?? '')}`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://webview.test/**', route => {
  const path = join(root, decodeURIComponent(new URL(route.request().url()).pathname));
  return existsSync(path) ? route.fulfill({ path }) : route.fulfill({ status: 404 });
});
let same = 0;
const different = [];
for (const dir of dirs) {
  for (const path of files(dir).sort()) {
    const text = readFileSync(path, 'utf8');
    await page.goto(harness);
    const saved = await page.evaluate(async ({ text, labels }) => {
      const wait = check => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('o editor não respondeu')), 15_000);
        const timer = setInterval(() => {
          const found = window.sent.find(check);
          if (found) { clearInterval(timer); clearTimeout(timeout); resolve(found); }
        }, 20);
      });
      await wait(m => m.type === 'loaded');
      window.postMessage({ type: 'init', text, language: 'pt-br', baseUri: 'http://webview.test/docs', labels }, '*');
      await wait(m => m.type === 'ready');
      window.postMessage({ type: 'test:getSaved', id: 1 }, '*');
      return (await wait(m => m.type === 'test:saved')).text;
    }, { text, labels: LABELS });
    if (saved === text) same++;
    else different.push(`${relative(process.cwd(), path)}\n    ${firstDiff(text, saved)}`);
  }
}
await browser.close();
console.log(`${same} idênticas, ${different.length} diferentes`);
for (const line of different) console.log(`  ${line}`);
