// Bundles da extensão (esbuild): host Node (desktop), host web (vscode.dev), webview e os testes.
// Uso: node build.mjs [--watch] [--production]
import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** O Crepe importa o KaTeX mesmo com o LaTeX desligado: no bundle, entra o webview/katexStub.ts. */
const withoutKatex = {
  name: 'without-katex',
  setup(build) {
    const stub = fileURLToPath(new URL('webview/katexStub.ts', import.meta.url));
    build.onResolve({ filter: /^katex$/ }, () => ({ path: stub }));
  },
};

/** @type {esbuild.BuildOptions[]} */
const builds = [
  // Host no VS Code desktop
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  // Host no vscode.dev (web worker): o mesmo código, sem APIs do Node
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/web/extension.js',
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    external: ['vscode'],
  },
  // Webview: React + Milkdown; o CSS importado sai em dist/webview/main.css. Em ESM com `splitting`:
  // as linguagens dos blocos de código (`@codemirror/language-data`) vêm em pedaços à parte, carregados
  // só quando a página tem um bloco daquela linguagem
  {
    ...common,
    entryPoints: { main: 'webview/main.tsx' },
    outdir: 'dist/webview',
    chunkNames: 'chunks/[name]-[hash]',
    splitting: true,
    plugins: [withoutKatex],
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  },
  // Testes de integração: a mesma suíte no desktop (Node) e no navegador
  {
    ...common,
    entryPoints: ['test/vscode/suite/index.ts'],
    outfile: 'out-test/node/index.js',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode', 'mocha'],
  },
  {
    ...common,
    entryPoints: ['test/vscode/suite/index.web.ts'],
    outfile: 'out-test/web/index.js',
    platform: 'browser',
    // O Mocha de navegador é UMD e troca o module.exports do bundle pelo dele (o VS Code chamaria o
    // run do Mocha): IIFE e o module.exports definido no fim, depois do Mocha
    format: 'iife',
    globalName: 'techdocsEditorTests',
    footer: { js: 'module.exports = techdocsEditorTests;' },
    target: 'es2022',
    external: ['vscode'],
  },
];

// Pedaços de builds anteriores (o nome muda com o conteúdo)
rmSync('dist/webview', { recursive: true, force: true });

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map(options => esbuild.build(options)));
}
