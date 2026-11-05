// Todas as suítes, uma depois da outra, cada uma com limite de tempo: a média medida + 10% (spec 03, "Limite de tempo
// das suítes"). Passou do limite: mata o processo e os filhos dele (VS Code, Chromium), mostra o fim da saída e para,
// em vez de ficar travado. O build roda uma vez só, antes das suítes que usam o dist/.
//
//   node scripts/test-all.mjs              todas
//   node scripts/test-all.mjs vscode e2e   só essas (o build entra sozinho quando alguma delas precisa)
//   TEST_TIMEOUT_SCALE=2 ...               limites em dobro (máquina mais lenta)
//
// No fim, a tabela com o tempo de cada suíte e o limite: base para recalcular as médias quando as suítes crescerem.
import { spawn } from 'node:child_process';

/**
 * Média das execuções que passaram em 2026-10-31 (WSL2; 2 a 3 rodadas por suíte, o e2e só 1), em segundos; editor e
 * web medidos de novo em 2026-11-05 (cresceram com o Mermaid). O limite é
 * a média + 10%. Estimativa: refazer a conta com a tabela do fim quando as suítes crescerem.
 */
const AVERAGE = {
  typecheck: 8.8,
  unit: 3.6,
  build: 1.6,
  webview: 30.5,
  bundle: 2.9,
  editor: 194.6,
  vscode: 86.4,
  web: 53.8,
  e2e: 205.4,
};
/** Abaixo disso a variação (cache do tsc, disco) pesa mais que os 10%: nenhum limite menor que este. */
const MIN_LIMIT = 30;
const SCALE = Number(process.env.TEST_TIMEOUT_SCALE ?? 1) || 1;

const playwright = config => ['npx', ['playwright', 'test', '-c', config]];
const STEPS = [
  { name: 'typecheck', run: ['npm', ['run', '--silent', 'typecheck']] },
  { name: 'unit', run: ['npx', ['vitest', 'run']] },
  { name: 'build', run: ['npm', ['run', '--silent', 'build']] },
  { name: 'webview', run: playwright('packages/extension/test/webview/playwright.config.ts'), build: true },
  { name: 'bundle', run: ['node', ['packages/extension/test/bundle-size.mjs']], build: true },
  { name: 'editor', run: playwright('packages/ui/e2e/playwright.config.ts') },
  { name: 'vscode', run: ['node', ['packages/extension/test/vscode/run.mjs']], build: true },
  { name: 'web', run: ['node', ['packages/extension/test/vscode/run-web.mjs']], build: true },
  { name: 'e2e', run: playwright('packages/extension/e2e/playwright.config.ts'), build: true },
];

const limitOf = name => Math.max(MIN_LIMIT, Math.ceil(AVERAGE[name] * 1.1)) * SCALE;
const seconds = ms => (ms / 1000).toFixed(1);

const wanted = process.argv.slice(2);
const unknown = wanted.filter(name => !STEPS.some(step => step.name === name));
if (unknown.length) {
  console.error(`Suíte desconhecida: ${unknown.join(', ')}. Opções: ${STEPS.map(step => step.name).join(', ')}`);
  process.exit(2);
}
const needsBuild = STEPS.some(step => step.build && wanted.includes(step.name));
const steps = wanted.length ? STEPS.filter(step => wanted.includes(step.name) || (step.name === 'build' && needsBuild)) : STEPS;

let current;
/** Mata o grupo de processos inteiro: o npx/node da suíte e o que ele abriu (VS Code, Chromium, servidor). */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }, 5000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (current) killTree(current);
    process.exit(130);
  });
}

function runStep(step) {
  const [command, args] = step.run;
  const limit = limitOf(step.name);
  console.log(`\n▶ ${step.name} (limite ${limit}s)`);
  // Relógio monotônico: o do sistema dá saltos no WSL ao sincronizar, e o tempo da tabela saía maior que o real
  const started = performance.now();
  const tail = [];
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Grupo próprio: no limite, o kill alcança os netos (o VS Code do test-electron, o Chromium do Playwright)
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
    });
    current = child;
    const keep = chunk => {
      tail.push(...chunk.toString().split('\n'));
      tail.splice(0, Math.max(0, tail.length - 60));
    };
    child.stdout.on('data', chunk => (process.stdout.write(chunk), keep(chunk)));
    child.stderr.on('data', chunk => (process.stderr.write(chunk), keep(chunk)));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, limit * 1000);
    child.on('close', code => {
      clearTimeout(timer);
      current = undefined;
      resolve({ name: step.name, code: timedOut ? 124 : code ?? 1, timedOut, elapsed: performance.now() - started, limit, tail });
    });
  });
}

const results = [];
for (const step of steps) {
  const result = await runStep(step);
  results.push(result);
  if (result.code !== 0) break;
}

console.log('\nSuíte       tempo   limite  resultado');
for (const r of results) {
  const status = r.timedOut ? 'PASSOU DO LIMITE' : r.code === 0 ? 'ok' : `falhou (${r.code})`;
  console.log(`${r.name.padEnd(10)} ${seconds(r.elapsed).padStart(6)}s ${String(r.limit).padStart(6)}s  ${status}`);
}
const last = results.at(-1);
if (last?.timedOut) {
  console.error(
    `\n✖ ${last.name} passou de ${last.limit}s (média + 10%) e foi interrompida: algo travou ou ficou mais lento.` +
      `\nO fim da saída, para investigar (rode só ela: node scripts/test-all.mjs ${last.name}):\n`,
  );
  console.error(last.tail.filter(line => line.trim()).slice(-30).join('\n'));
}
process.exit(last?.code ?? 0);
