import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

/** O canal "TechDocs Editor" do painel Output (criado no primeiro uso). */
function log(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel('TechDocs Editor', { log: true });
  return channel;
}

/** Uma linha no canal "TechDocs Editor" (para medir o que demora no VS Code de quem usa). */
export function logLine(message: string) {
  log().info(message);
}

let current: { name: string; start: number; last: number } | undefined;

/**
 * Tempos de uma ação demorada (ex.: "Criar a documentação"), no canal "TechDocs Editor": `begin` abre a medição,
 * `step` registra quanto cada etapa levou e `end` o total. Fora de uma medição, `step` não faz nada.
 */
export const timing = {
  begin(name: string) {
    const now = performance.now();
    current = { name, start: now, last: now };
    log().info(`${name}: início`);
  },
  step(label: string) {
    if (!current) return;
    const now = performance.now();
    log().info(`${current.name}: ${label} (+${Math.round(now - current.last)} ms)`);
    current.last = now;
  },
  end() {
    if (!current) return;
    log().info(`${current.name}: total ${Math.round(performance.now() - current.start)} ms`);
    current = undefined;
  },
};

/**
 * Avisa no canal "TechDocs Editor" quando o processo das extensões fica parado (nenhum código roda) por mais de
 * `LAG_MS`: as extensões do VS Code dividem o mesmo processo, e uma delas ocupada (indexando o ~, por exemplo)
 * atrasa tudo, a árvore junto. Ajuda a separar "a extensão está lenta" de "o processo estava ocupado".
 */
export function watchLag(): { dispose(): void } {
  const LAG_MS = 1000;
  const TICK_MS = 250;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - last - TICK_MS;
    if (lag > LAG_MS) log().warn(`processo das extensões parado por ${Math.round(lag)} ms (outra extensão ou a própria ocupada)`);
    last = now;
  }, TICK_MS);
  return { dispose: () => clearInterval(timer) };
}
