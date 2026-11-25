import * as vscode from 'vscode';

/**
 * As configurações pelo menu "…" da seção Documentação (spec 09): quem usa a extensão não precisa conhecer o
 * Ctrl+Shift+P nem o nome das configurações. Gravadas para a pessoa (usuário), valem em todos os repositórios.
 */

const config = () => vscode.workspace.getConfiguration('techdocsEditor');

/** Configurações do TechDocs: as do VS Code, só as da extensão. */
export function openSettings() {
  return vscode.commands.executeCommand('workbench.action.openSettings', '@ext:edtroleis.techdocs-editor');
}

/** Como enviar: para revisão (pull request) ou direto na branch principal. `value`: testes. */
export async function chooseSendTarget(value?: 'pullRequest' | 'main') {
  const current = config().get<string>('send.target') === 'main' ? 'main' : 'pullRequest';
  const target =
    value ??
    (
      await vscode.window.showQuickPick(
        [
          {
            label: vscode.l10n.t('For review'),
            description: current === 'pullRequest' ? vscode.l10n.t('current') : undefined,
            detail: vscode.l10n.t('Someone on the team approves on GitHub before it goes into the documentation.'),
            value: 'pullRequest' as const,
          },
          {
            label: vscode.l10n.t('Straight to the documentation'),
            description: current === 'main' ? vscode.l10n.t('current') : undefined,
            detail: vscode.l10n.t('Goes into the main branch right away, without review. Only for repositories that allow it.'),
            value: 'main' as const,
          },
        ],
        { title: vscode.l10n.t('How to send'), placeHolder: vscode.l10n.t('Where Send puts your changes') },
      )
    )?.value;
  if (!target) return;
  await config().update('send.target', target, vscode.ConfigurationTarget.Global);
}

/** Onde ficam as cópias do GitHub: o diretório onde "Abrir documentação do GitHub" clona. `value`: testes. */
export async function chooseCloneDirectory(value?: string) {
  let directory = value;
  if (directory === undefined) {
    const current = config().get<string>('clone.directory') || '~/Documents/TechDocs';
    const choose = vscode.l10n.t('Choose a directory…');
    const answer = await vscode.window.showInformationMessage(
      vscode.l10n.t('The documentation from GitHub comes to {0}.', current),
      choose,
    );
    if (answer !== choose) return;
    const [picked] =
      (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: vscode.l10n.t('Use this directory') })) ?? [];
    directory = picked?.fsPath;
  }
  if (!directory) return;
  await config().update('clone.directory', directory, vscode.ConfigurationTarget.Global);
}
