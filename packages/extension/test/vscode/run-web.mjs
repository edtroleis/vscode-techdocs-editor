// Suíte de integração no VS Code para navegador (o mesmo código que roda no vscode.dev).
import { runTests } from '@vscode/test-web';
import { join } from 'node:path';
import { createWorkspace, extensionRoot } from './workspace.mjs';

try {
  await runTests({
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
