import Mocha from 'mocha';
import { defineTests } from './tests';

/** Entrada da suíte no VS Code desktop (@vscode/test-electron). */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60_000 });
  mocha.suite.emit('pre-require', globalThis, 'tests', mocha);
  defineTests();
  return new Promise((resolve, reject) =>
    mocha.run(failures => (failures ? reject(new Error(`${failures} teste(s) falharam`)) : resolve())),
  );
}
