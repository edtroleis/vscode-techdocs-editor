#!/usr/bin/env node
// Baixa o VS Code de teste (.vscode-test/) antes das suítes, com novas tentativas. O @vscode/test-electron baixa uma
// vez só: um tempo esgotado na rede (ETIMEDOUT no update.code.visualstudio.com) derrubava o job inteiro sem rodar
// nenhum teste (Release da 0.13.0). Com a cópia já baixada, as suítes não dependem mais da rede: se a consulta da
// versão estável falhar lá, o test-electron usa a cópia instalada.
//
// Uso (no CI, antes de test:vscode e test:e2e): node scripts/download-vscode.mjs
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { join } from 'node:path';

const ATTEMPTS = 4;
/** Cada tentativa tem um limite: um download parado não segura o job até o timeout dele. */
const ATTEMPT_LIMIT_MS = 5 * 60_000;
const cachePath = join(import.meta.dirname, '..', '.vscode-test');
const version = process.env.VSCODE_VERSION ?? 'stable';

const withLimit = promise =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`passou de ${ATTEMPT_LIMIT_MS / 1000} s`)), ATTEMPT_LIMIT_MS).unref())]);

for (let attempt = 1; ; attempt++) {
  try {
    const executable = await withLimit(downloadAndUnzipVSCode({ version, cachePath }));
    console.log(`VS Code de teste pronto: ${executable}`);
    break;
  } catch (error) {
    if (attempt === ATTEMPTS) {
      console.error(`Não deu para baixar o VS Code de teste em ${ATTEMPTS} tentativas.`);
      throw error;
    }
    const wait = 10 * 2 ** (attempt - 1);
    console.warn(`Tentativa ${attempt} de ${ATTEMPTS} falhou (${error?.message ?? error}); de novo em ${wait} s.`);
    await new Promise(resolve => setTimeout(resolve, wait * 1000));
  }
}
