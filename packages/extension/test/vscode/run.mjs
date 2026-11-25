// Suíte de integração no VS Code desktop. Baixa o VS Code na primeira vez (.vscode-test/).
import { runTests } from '@vscode/test-electron';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import workspaceModule from './workspace.cjs';
const { createWorkspace, createPublishRepo, extensionRoot } = workspaceModule;

// O ~/.gitconfig de quem roda fica de fora: o nome e e-mail do Git (spec 09, tela 13) são gravados aqui
process.env.GIT_CONFIG_GLOBAL = join(mkdtempSync(join(tmpdir(), 'techdocs-gitconfig-')), 'gitconfig');
writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
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
