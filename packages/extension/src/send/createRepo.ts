import * as vscode from 'vscode';

/** Onde criar o repositório no GitHub (spec 09, tela 12). */
export type OwnerChoice = { owner: string; org?: boolean; name: string; private: boolean };

/** Tela 12: a conta ou organização, o nome (o do diretório) e privado (marcado) ou público. */
export async function createRepoUi(owners: Array<{ login: string; org: boolean }>, folderName: string): Promise<OwnerChoice | undefined> {
  const title = vscode.l10n.t('Create the repository on GitHub');
  const owner =
    owners.length === 1
      ? owners[0]
      : (
          await vscode.window.showQuickPick(
            owners.map(o => ({ label: o.login, description: o.org ? vscode.l10n.t('organization') : vscode.l10n.t('your account'), owner: o })),
            { title, placeHolder: vscode.l10n.t('Where the documentation lives on GitHub'), ignoreFocusOut: true },
          )
        )?.owner;
  if (!owner) return undefined;
  const name = await vscode.window.showInputBox({
    title,
    prompt: vscode.l10n.t('Repository name'),
    value: folderName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
    ignoreFocusOut: true,
    validateInput: value => (/^[A-Za-z0-9._-]+$/.test(value) ? undefined : vscode.l10n.t('Use letters, numbers, dots, dashes and underscores.')),
  });
  if (!name) return undefined;
  const visibility = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('Private'), detail: vscode.l10n.t('Only who you invite sees it.'), private: true },
      { label: vscode.l10n.t('Public'), detail: vscode.l10n.t('Anyone on the internet sees it.'), private: false },
    ],
    { title, placeHolder: vscode.l10n.t('Who can see it'), ignoreFocusOut: true },
  );
  if (!visibility) return undefined;
  return { owner: owner.login, org: owner.org, name, private: visibility.private };
}
