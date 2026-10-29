// Bundles da extensão (esbuild): host Node (desktop), host web (vscode.dev), webview e os testes.
// Uso: node build.mjs [--watch] [--production]
import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

/** `import texto from './x.md?raw'`: o arquivo como texto (templates do core, spec 04). */
const rawImports = {
  name: 'raw-imports',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({
      path: fileURLToPath(new URL(args.path.replace(/\?raw$/, ''), `file://${args.resolveDir}/`)),
      namespace: 'raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
      watchFiles: [args.path],
    }));
  },
};

/** @type {esbuild.BuildOptions[]} */
const builds = [
  // Host no VS Code desktop
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    plugins: [rawImports],
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
    plugins: [rawImports],
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
  // Webview do painel "Publicação": HTML simples, sem React
  {
    ...common,
    entryPoints: { panel: 'webview/panel.ts' },
    outdir: 'dist/webview',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  },
  // Webview da prévia da documentação nova: também HTML simples
  {
    ...common,
    entryPoints: { preview: 'webview/preview.ts' },
    outdir: 'dist/webview',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  },
  // Testes de integração: a mesma suíte no desktop (Node) e no navegador
  {
    ...common,
    entryPoints: ['test/vscode/suite/index.ts'],
    outfile: 'out-test/node/index.js',
    plugins: [rawImports],
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode', 'mocha'],
  },
  {
    ...common,
    entryPoints: ['test/vscode/suite/index.web.ts'],
    outfile: 'out-test/web/index.js',
    plugins: [rawImports],
    platform: 'browser',
    // O Mocha de navegador é UMD e troca o module.exports do bundle pelo dele (o VS Code chamaria o
    // run do Mocha): IIFE e o module.exports definido no fim, depois do Mocha
    format: 'iife',
    globalName: 'techdocsEditorTests',
    footer: { js: 'module.exports = techdocsEditorTests;' },
    // TEST_GREP=Templates também no navegador, onde não há process.env
    define: { 'process.env.TEST_GREP': JSON.stringify(process.env.TEST_GREP ?? '') },
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
