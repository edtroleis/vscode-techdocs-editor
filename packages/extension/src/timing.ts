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
