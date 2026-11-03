// Cenários de usuário: compila, roda os cenários (os argumentos vão para o Playwright, ex.: `01` ou `--grep GitHub`)
// e monta o relatório, mesmo quando algum cenário falha.
// Nunca fica parado: passado o limite (SCENARIOS_LIMIT_MIN, padrão 10 min com FAST=1 e 40 sem), o Playwright e o
// VS Code de teste são encerrados à força (uma caixa modal aberta segura o fechamento normal do VS Code).
import { spawnSync } from 'node:child_process';

const run = (command, args, timeout) =>
  spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', timeout, killSignal: 'SIGKILL' });

/** Os VS Code de teste (em `.vscode-test`) que sobraram de uma rodada interrompida. */
function killTestVSCode() {
  if (process.platform === 'win32') return;
  spawnSync('pkill', ['-9', '-f', '\\.vscode-test/vscode-']);
}

if (run('npm', ['run', 'build']).status !== 0) process.exit(1);
killTestVSCode();
const minutes = Number(process.env.SCENARIOS_LIMIT_MIN) || (process.env.FAST ? 10 : 40);
const result = run('npx', ['playwright', 'test', '-c', 'packages/extension/e2e/scenarios/playwright.config.ts', ...process.argv.slice(2)], minutes * 60_000);
const stuck = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL';
killTestVSCode();
if (stuck) console.error(`\nCenários encerrados à força: passaram de ${minutes} min (o relatório mostra até onde chegaram).`);
run('node', ['scripts/scenarios-report.mjs']);
process.exit(stuck ? 124 : (result.status ?? 1));
