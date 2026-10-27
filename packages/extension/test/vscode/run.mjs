// Suíte de integração no VS Code desktop. Baixa o VS Code na primeira vez (.vscode-test/).
import { runTests } from '@vscode/test-electron';
import { join } from 'node:path';
import workspaceModule from './workspace.cjs';
const { createWorkspace, extensionRoot } = workspaceModule;

const workspace = createWorkspace();
try {
  await runTests({
    version: process.env.VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath: extensionRoot,
    extensionTestsPath: join(extensionRoot, 'out-test', 'node', 'index.js'),
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--ozone-platform=headless'],
  });
} catch (error) {
  console.error(error);
  process.exit(1);
}
