import Mocha from 'mocha';
import { definePublishTests } from './publish';
import { defineSendTests } from './send';
import { defineRemoteTests } from './remote';
import { defineTests } from './tests';

/** Entrada da suíte no VS Code desktop (@vscode/test-electron). */
export function run(): Promise<void> {
  // TEST_GREP=Templates roda só os testes com esse texto no nome
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60_000, retries: process.env.CI ? 1 : 0, grep: process.env.TEST_GREP });
  mocha.suite.emit('pre-require', globalThis, 'tests', mocha);
  defineTests();
  definePublishTests();
  defineRemoteTests();
  defineSendTests();
  return new Promise((resolve, reject) =>
    mocha.run(failures => (failures ? reject(new Error(`${failures} teste(s) falharam`)) : resolve())),
  );
}
