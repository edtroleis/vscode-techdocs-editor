#!/usr/bin/env node
// Antes de empacotar a extensão (vscode:prepublish, rodado pelo vsce em packages/extension): build de
// produção e os documentos da raiz copiados para o pacote. Os da raiz são a fonte (o GitHub mostra esses);
// os copiados não vão para o git (.gitignore).
import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const extension = join(root, 'packages/extension');

execFileSync(process.execPath, ['build.mjs', '--production'], { cwd: extension, stdio: 'inherit' });
for (const file of ['README.md', 'README.pt-BR.md', 'CHANGELOG.md', 'LICENSE']) {
  copyFileSync(join(root, file), join(extension, file));
}
