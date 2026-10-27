// Bundles da extensão (esbuild): host Node (desktop), host web (vscode.dev), webview e os testes.
// Uso: node build.mjs [--watch] [--production]
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
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
  // Webview: React + Milkdown; o CSS importado sai em dist/webview/main.css
  {
    ...common,
    entryPoints: ['webview/main.tsx'],
    outfile: 'dist/webview/main.js',
    platform: 'browser',
    format: 'iife',
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

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map(options => esbuild.build(options)));
}
