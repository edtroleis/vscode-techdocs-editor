// Abre cada página no editor visual da extensão (o bundle do webview, no Chromium, como o
// packages/extension/test/webview/roundtrip.mjs) e confere: abrir não manda edição, e o que o editor gravaria é o
// arquivo byte a byte. Uma página que muda só de abrir é uma página que a pessoa estraga sem querer.
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LABELS = {
  problemsOne: '1 formatting problem',
  problemsOther: '{0} formatting problems',
  fixAll: 'Fix automatically',
  line: 'Line {0}',
  showLine: 'Show line {0} in the Markdown text',
};

/** Primeira linha diferente: "linha 12: antes → depois". */
function firstDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  const i = x.findIndex((line, n) => line !== y[n]);
  const n = i === -1 ? x.length : i;
  return `linha ${n + 1}: ${JSON.stringify(x[n] ?? '').slice(0, 120)} → ${JSON.stringify(y[n] ?? '').slice(0, 120)}`;
}

/** `files`: [{ key, path }] (caminhos absolutos). Devolve, por `key`, { same, edits, diff?, failure? }. */
export async function editorRoundtrip({ extensionRoot, files, limit }) {
  const harness = 'http://webview.test/test/webview/harness.html';
  if (!existsSync(join(extensionRoot, 'dist', 'webview', 'main.js'))) throw new Error('sem o bundle do webview: rode npm run build');
  const browser = await chromium.launch();
  const deadline = Date.now() + limit * 1000;
  const results = {};
  try {
    const context = await browser.newContext();
    await context.route('http://webview.test/**', route => {
      const path = join(extensionRoot, decodeURIComponent(new URL(route.request().url()).pathname));
      return existsSync(path) ? route.fulfill({ path }) : route.fulfill({ status: 404 });
    });
    const queue = [...files];
    const worker = async () => {
      const page = await context.newPage();
      for (let file; (file = queue.shift()); ) {
        if (Date.now() > deadline) throw new Error(`a ida e volta no editor passou de ${limit} s`);
        const text = readFileSync(file.path, 'utf8');
        try {
          await page.goto(harness);
          const { saved, edits } = await page.evaluate(
            async ({ text, labels }) => {
              const wait = check =>
                new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => reject(new Error('o editor não respondeu em 15 s')), 15_000);
                  const timer = setInterval(() => {
                    const found = window.sent.find(check);
                    if (found) {
                      clearInterval(timer);
                      clearTimeout(timeout);
                      resolve(found);
                    }
                  }, 20);
                });
              await wait(m => m.type === 'loaded');
              window.postMessage({ type: 'init', text, language: 'pt-br', baseUri: 'http://webview.test/docs', labels }, '*');
              await wait(m => m.type === 'ready');
              // Um tempo para o editor mandar uma edição que não devia (normalização ao abrir)
              await new Promise(r => setTimeout(r, 400));
              window.postMessage({ type: 'test:getSaved', id: 1 }, '*');
              const saved = (await wait(m => m.type === 'test:saved')).text;
              return { saved, edits: window.sent.filter(m => m.type === 'edit').length };
            },
            { text, labels: LABELS },
          );
          results[file.key] = { same: saved === text, edits, ...(saved !== text && { diff: firstDiff(text, saved), original: text, saved }) };
        } catch (error) {
          results[file.key] = { same: false, edits: 0, failure: String(error.message ?? error).split('\n')[0] };
        }
      }
      await page.close();
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return results;
  } finally {
    await browser.close();
  }
}
