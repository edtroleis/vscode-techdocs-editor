// Suíte de integração no VS Code para navegador (o mesmo código que roda no vscode.dev).
import { runTests } from '@vscode/test-web';
import { createServer } from 'node:net';
import { join } from 'node:path';
import workspaceModule from './workspace.cjs';
const { createWorkspace, extensionRoot } = workspaceModule;

/**
 * Uma porta livre: a padrão do @vscode/test-web é a 3000, a mesma do Backstage local (a vitrine, spec 03), e com ele
 * no ar a suíte nem começava (EADDRINUSE).
 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

try {
  await runTests({
    port: Number(process.env.TEST_WEB_PORT) || (await freePort()),
    browserType: 'chromium',
    headless: process.env.HEADED ? false : true,
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: join(extensionRoot, 'out-test', 'web', 'index.js'),
    folderPath: createWorkspace(),
    quality: 'stable',
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
