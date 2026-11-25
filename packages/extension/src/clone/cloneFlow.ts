import { allowedHosts, parseRemoteInput, type RemoteTarget, validateOpenLink } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import { cloneRepository, gitApi } from '../publish/vscodeGit';
import { localClone } from '../remote/openRemote';
import { KnownClones, suggestedFolder } from './knownClones';

/**
 * Abrir documentação do GitHub (spec 09, telas A e B): a documentação sempre vive no computador. O repositório
 * já clonado (no workspace ou lembrado) abre direto; senão é clonado num diretório sugerido e aberto. O link do
 * Backstage (`vscode://edtroleis.techdocs-editor/open?host=…&repo=…&path=…`) faz o mesmo e abre a página.
 */

const PENDING = 'techdocsEditor.pendingOpen';
const GIT_DOWNLOAD = 'https://git-scm.com/downloads';
const config = () => vscode.workspace.getConfiguration('techdocsEditor');
const configuredHost = () => config().get<string>('github.host')?.trim().toLowerCase() || 'github.com';

type Pending = { folder: string; page?: string };

export type CloneDeps = {
  state: vscode.Memento;
  /** Testes: o diretório onde clonar sem perguntar. */
  parent?: string;
  /** Testes: o Git do VS Code (undefined simula o computador sem Git). */
  git?: typeof gitApi;
  /** Testes: o aviso mostrado à pessoa. */
  warn?: (message: string, ...actions: string[]) => Thenable<string | undefined>;
};

export class CloneFlow {
  readonly clones: KnownClones;

  constructor(private readonly deps: CloneDeps) {
    this.clones = new KnownClones(deps.state, async path => {
      const api = await gitApi();
      const repository = await api?.openRepository(vscode.Uri.file(path)).catch(() => null);
      const remote = repository?.state.remotes.find(r => r.name === 'origin');
      return remote?.fetchUrl ?? remote?.pushUrl;
    });
  }

  /** O link do Backstage, validado antes de tudo (B3). */
  async fromLink(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (uri.path !== '/open') {
      void vscode.window.showErrorMessage(vscode.l10n.t('Unknown TechDocs Editor link: {0}', uri.path));
      return undefined;
    }
    const result = validateOpenLink(uri.query, allowedHosts(configuredHost()));
    if (!result.ok) {
      const reasons = {
        host: vscode.l10n.t('The link points to a GitHub server that is not configured (techdocsEditor.github.host).'),
        repo: vscode.l10n.t('The link does not have a valid repository (owner/repo).'),
        path: vscode.l10n.t('The link does not point to a documentation page (.md) inside the repository.'),
      };
      void vscode.window.showErrorMessage(vscode.l10n.t('The link was not opened. {0}', reasons[result.reason]));
      return undefined;
    }
    return this.open(result.target);
  }

  /** Comando "Abrir documentação do GitHub…": o endereço ou `dono/repo` (`input` nos testes). */
  async fromInput(input?: string): Promise<vscode.Uri | undefined> {
    const text =
      input ??
      (await vscode.window.showInputBox({
        title: vscode.l10n.t('Open documentation from GitHub'),
        prompt: vscode.l10n.t('Repository (owner/repo) or the GitHub address of the repository, a folder or a page'),
        placeHolder: 'acme/wiki',
        ignoreFocusOut: true,
        validateInput: value => (!value.trim() || parseRemoteInput(value, configuredHost()) ? undefined : vscode.l10n.t('Not a GitHub repository address')),
      }));
    if (!text?.trim()) return undefined;
    const target = parseRemoteInput(text, configuredHost());
    if (!target) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Not a GitHub repository address: {0}', text));
      return undefined;
    }
    return this.open(target);
  }

  async open(target: RemoteTarget): Promise<vscode.Uri | undefined> {
    const api = await (this.deps.git ?? gitApi)().catch(() => undefined);
    if (!api) {
      const install = vscode.l10n.t('Install Git');
      const answer = await (this.deps.warn ?? vscode.window.showWarningMessage)(
        vscode.l10n.t('Git is needed to bring the documentation to this computer. Install it and open VS Code again.'),
        install,
      );
      if (answer === install) await vscode.env.openExternal(vscode.Uri.parse(GIT_DOWNLOAD));
      return undefined;
    }
    const page = target.path && /\.md$/i.test(target.path) ? target.path : undefined;
    // Já está no workspace: abre a página aqui
    const here = await localClone(target.host, target.slug);
    if (here) return openPage(here, page);
    // Já clonado antes: abre o diretório (a página abre quando a janela voltar)
    const known = await this.clones.find(target.host, target.slug);
    if (known) return this.openFolder(vscode.Uri.file(known), page);

    const name = target.slug.split('/')[1];
    const folder = this.deps.parent ? `${this.deps.parent}/${name}` : await this.askFolder(name);
    if (!folder) return undefined;
    const parent = vscode.Uri.file(folder.replace(/[\\/][^\\/]+$/, ''));
    if (await exists(vscode.Uri.file(folder))) {
      void vscode.window.showErrorMessage(vscode.l10n.t('{0} already exists. Choose another directory.', folder));
      return undefined;
    }
    await vscode.workspace.fs.createDirectory(parent);
    const url = `https://${target.host}/${target.slug}.git`;
    const cloned = await cloneRepository(url, parent);
    if (!cloned) return undefined;
    await this.clones.remember(target.host, target.slug, cloned.fsPath);
    return this.openFolder(cloned, page);
  }

  /** Tela A: o diretório sugerido, que a pessoa pode trocar. */
  private async askFolder(name: string): Promise<string | undefined> {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    const suggested = suggestedFolder(config().get<string>('clone.folder') ?? '', name, home);
    const change = vscode.l10n.t('Choose another directory');
    const answer = await vscode.window.showInformationMessage(
      vscode.l10n.t('The documentation comes to this computer, in {0}. You edit it here and send it to GitHub when you want.', suggested),
      { modal: true },
      vscode.l10n.t('Bring it'),
      change,
    );
    if (answer === change) {
      const [picked] =
        (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: vscode.l10n.t('Bring it here') })) ?? [];
      return picked ? `${picked.fsPath}/${name}` : undefined;
    }
    return answer ? suggested : undefined;
  }

  /** Abre o diretório nesta janela; a página do link fica guardada e abre na ativação. */
  private async openFolder(folder: vscode.Uri, page: string | undefined): Promise<vscode.Uri | undefined> {
    await this.deps.state.update(PENDING, { folder: folder.fsPath, page } satisfies Pending);
    await vscode.commands.executeCommand('vscode.openFolder', folder, { forceNewWindow: false });
    return page ? vscode.Uri.joinPath(folder, page) : folder;
  }

  /** Na ativação: a página do link que trouxe o diretório. */
  async openPending(): Promise<void> {
    const pending = this.deps.state.get<Pending>(PENDING);
    if (!pending) return;
    const folder = vscode.workspace.workspaceFolders?.find(f => f.uri.fsPath === pending.folder);
    if (!folder) return;
    await this.deps.state.update(PENDING, undefined);
    await openPage(folder.uri, pending.page);
  }
}

async function exists(uri: vscode.Uri) {
  return vscode.workspace.fs.stat(uri).then(
    () => true,
    () => false,
  );
}

async function openPage(root: vscode.Uri, page: string | undefined): Promise<vscode.Uri | undefined> {
  void vscode.commands.executeCommand('workbench.view.extension.techdocs');
  if (!page) return root;
  const uri = vscode.Uri.joinPath(root, page);
  await vscode.commands.executeCommand('vscode.open', uri);
  return uri;
}
