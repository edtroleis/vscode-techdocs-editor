// Mocha para navegador: define o global `mocha`
import 'mocha/mocha';
import { defineTests } from './tests';

/** Entrada da suíte no VS Code para navegador (@vscode/test-web). */
export function run(): Promise<void> {
  // Sem DOM no host web (web worker): o reporter padrão do navegador (HTML) não funciona
  mocha.setup({ ui: 'tdd', reporter: 'spec', color: true, timeout: 60_000, grep: process.env.TEST_GREP || undefined });
  defineTests();
  return new Promise((resolve, reject) =>
    mocha.run(failures => (failures ? reject(new Error(`${failures} teste(s) falharam`)) : resolve())),
  );
}
