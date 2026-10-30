// Cenários de usuário: compila, roda os cenários (os argumentos vão para o Playwright, ex.: `01` ou `--grep GitHub`)
// e monta o relatório, mesmo quando algum cenário falha.
import { spawnSync } from 'node:child_process';

const run = (command, args) => spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;

if (run('npm', ['run', 'build']) !== 0) process.exit(1);
const status = run('npx', ['playwright', 'test', '-c', 'packages/extension/e2e/scenarios/playwright.config.ts', ...process.argv.slice(2)]);
run('node', ['scripts/scenarios-report.mjs']);
process.exit(status);
