// Suíte de integração no VS Code desktop. Baixa o VS Code na primeira vez (.vscode-test/).
import { runTests } from '@vscode/test-electron';
import { join } from 'node:path';
import workspaceModule from './workspace.cjs';
const { createWorkspace, createPublishRepo, extensionRoot } = workspaceModule;

const workspace = createWorkspace();
// Lido pela suíte do painel de publicação (test/vscode/suite/publish.ts)
process.env.TECHDOCS_TEST_REMOTE = createPublishRepo(workspace);
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
