import type { GitHubClient } from '@edtroleis/techdocs-editor-core';
import { parseGitHubRemote } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import { clientFor } from '../publish/githubAuth';
import type { RepoGit } from '../publish/types';
import { initRepository, setGlobalIdentity } from '../publish/vscodeGit';
import { createRepoUi, type OwnerChoice } from './createRepo';

/**
 * Antes do primeiro envio (spec 09, telas 5, 12 e 13): o diretório vira repositório ligado ao GitHub se ainda não
 * é, e o Git ganha nome e e-mail se não tem. O login do GitHub é pedido pelo VS Code na primeira chamada à API
 * (`createIfNone`). A permissão de escrita fica com o `Sender` (`cannotWrite`).
 */

export type IdentityChoice = { name: string; email: string; detail?: string };

export type PreflightUi = {
  /** Onde criar o repositório (tela 12); undefined: a pessoa desistiu. */
  pickOwner(owners: Array<{ login: string; org: boolean }>, name: string): Promise<OwnerChoice | undefined>;
  /** Nome e e-mail do Git (tela 13), o e-mail privado do GitHub por último; undefined: a pessoa desistiu. */
  pickIdentity(choices: IdentityChoice[]): Promise<IdentityChoice | undefined>;
};

const HOST = 'github.com';

export async function preflight(
  git: RepoGit | undefined,
  folder: vscode.Uri,
  ui: Partial<PreflightUi> = {},
): Promise<{ git: RepoGit; client: GitHubClient; firstSend: boolean } | undefined> {
  const pick = { ...defaultUi, ...ui };
  let firstSend = false;
  await git?.refresh();
  let remote = git?.remoteUrl() ? parseGitHubRemote(git.remoteUrl()!) : undefined;
  if (!remote) {
    const account = clientFor(HOST, '');
    const name = decodeURIComponent(folder.path.split('/').filter(Boolean).pop() ?? 'docs');
    const owner = await pick.pickOwner(await account.listRepoOwners(), name);
    if (!owner) return undefined;
    const created = await account.createRepository({ owner: owner.owner, org: owner.org ?? false, name: owner.name, private: owner.private });
    git ??= await initRepository(folder);
    await git.addRemote('origin', created.cloneUrl);
    await git.refresh();
    remote = { host: HOST, slug: created.slug };
    firstSend = true;
  }
  const client = clientFor(remote.host, remote.slug);
  const identity = await git!.identity();
  if (!identity.name || !identity.email) {
    const me = await client.getIdentity();
    const name = identity.name ?? me.name ?? me.login;
    const emails = [...me.emails].sort((a, b) => Number(b.primary) - Number(a.primary)).map(e => e.email).filter(e => e !== me.noreply);
    const choice = await pick.pickIdentity([
      ...emails.map(email => ({ name, email })),
      { name, email: me.noreply, detail: vscode.l10n.t('Keeps your email private: GitHub still links the changes to your account.') },
    ]);
    if (!choice) return undefined;
    await setGlobalIdentity(choice.name, choice.email);
    await git!.refresh();
  }
  return { git: git!, client, firstSend };
}

const defaultUi: PreflightUi = {
  pickOwner: createRepoUi,
  async pickIdentity(choices) {
    const picked = await vscode.window.showQuickPick(
      choices.map(c => ({ label: c.email, description: c.name, detail: c.detail, choice: c })),
      {
        title: vscode.l10n.t('Your name and email on the changes'),
        placeHolder: vscode.l10n.t('Who sends the changes: shown on GitHub. It is set once for this computer.'),
        ignoreFocusOut: true,
      },
    );
    return picked?.choice;
  },
};
