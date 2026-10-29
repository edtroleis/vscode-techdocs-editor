import * as vscode from 'vscode';
import {
  allowedHosts,
  entryAt,
  parseGitHubRemote,
  parseRemoteInput,
  type RemoteSite,
  type RemoteTarget,
  siteOfPath,
  validateOpenLink,
} from '@edtroleis/techdocs-editor-core';
import { gitApi } from '../publish/vscodeGit';
import { remoteUri } from './remoteFs';
import { type RemoteRepos, type RepoAccess, SignInRequiredError } from './remoteRepos';

const VISUAL_VIEW_TYPE = 'techdocsEditor.visual';
const config = () => vscode.workspace.getConfiguration('techdocsEditor');
/** Host do GitHub da empresa (`techdocsEditor.github.host`); github.com por padrão. */
const configuredHost = () => config().get<string>('github.host')?.trim().toLowerCase() || 'github.com';

/** Página que abre quando só o site foi pedido: a inicial do MkDocs, senão a primeira página. */
function homePage(access: RepoAccess, site: RemoteSite): string | undefined {
  for (const name of ['index.md', 'README.md']) {
    const path = `${site.docsDir}/${name}`;
    if (entryAt(access.files, path)?.type === 'file') return path;
  }
  return access.files
    .map(f => f.path)
    .filter(path => path.startsWith(`${site.docsDir}/`) && /\.md$/i.test(path))
    .sort()[0];
}

/** Sites que o caminho pedido indica: o que tem a página, os que estão na pasta pedida, ou todos. */
function candidateSites(sites: RemoteSite[], path: string | undefined): RemoteSite[] {
  if (!path) return sites;
  const owner = siteOfPath(sites, path);
  if (owner) return [owner];
  const inside = sites.filter(site => site.root === path || site.root.startsWith(`${path}/`) || `${site.root}/mkdocs.yml` === `/${path}`);
  return inside.length ? inside : sites;
}

/**
 * Abrir documentação do GitHub (fase 4b): pelo comando (URL ou `dono/repo`) ou pelo link
 * `vscode://edtroleis.techdocs-editor/open?…` (B1). Com `techdocsEditor.mode`, a cópia local do workspace
 * pode ser usada no lugar do GitHub.
 */
export class RemoteOpener {
  constructor(private readonly repos: RemoteRepos) {}

  /** Comando "Abrir documentação do GitHub…": `input` (testes) evita a pergunta. */
  async fromInput(input?: string, pickSite?: (sites: RemoteSite[]) => RemoteSite | undefined): Promise<vscode.Uri | undefined> {
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
    return this.open(target, pickSite);
  }

  /** Link `vscode://edtroleis.techdocs-editor/open?host=…&repo=…&path=…` (B1): validado antes de tudo (B3). */
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

  /** Abre o repositório pedido: a cópia local (conforme `techdocsEditor.mode`) ou o GitHub. */
  async open(target: RemoteTarget, pickSite?: (sites: RemoteSite[]) => RemoteSite | undefined): Promise<vscode.Uri | undefined> {
    const mode = config().get<'auto' | 'local' | 'remote'>('mode') ?? 'auto';
    if (mode !== 'remote') {
      const local = await localClone(target.host, target.slug);
      if (local) {
        const useLocal =
          mode === 'local' ||
          (await vscode.window.showInformationMessage(
            vscode.l10n.t('{0} is also in this workspace. Open the local copy or the GitHub version?', target.slug),
            vscode.l10n.t('Open the local copy'),
            vscode.l10n.t('Open from GitHub'),
          )) === vscode.l10n.t('Open the local copy');
        if (useLocal) return openLocal(local, target.path);
      } else if (mode === 'local') {
        void vscode.window.showWarningMessage(
          vscode.l10n.t('{0} is not in this workspace. Clone it, or change techdocsEditor.mode to open it from GitHub.', target.slug),
        );
        return undefined;
      }
    }

    const access = await this.signedAccess(target);
    if (!access) return undefined;
    const candidates = candidateSites(access.sites, target.path);
    if (!candidates.length) {
      void vscode.window.showErrorMessage(vscode.l10n.t('{0} has no TechDocs documentation (mkdocs.yml).', target.slug));
      return undefined;
    }
    const site = candidates.length === 1 ? candidates[0] : await (pickSite ? pickSite(candidates) : chooseSite(candidates));
    if (!site) return undefined;

    await this.repos.add({ host: target.host, slug: target.slug, root: site.root });
    const asked = target.path && /\.md$/i.test(target.path) && siteOfPath([site], target.path) ? target.path : undefined;
    const page = asked ?? homePage(access, site);
    void vscode.commands.executeCommand('workbench.view.extension.techdocs');
    if (access.login && !access.repo.canWrite) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('You can only read this documentation. Ask {0} for write access to the repository.', target.slug.split('/')[0]),
      );
    }
    if (!page) return undefined;
    const uri = remoteUri(target.host, target.slug, page);
    await vscode.commands.executeCommand('vscode.openWith', uri, VISUAL_VIEW_TYPE);
    return uri;
  }

  /** O repositório, pedindo o login quando ele não aparece sem (repositório privado). */
  private async signedAccess(target: RemoteTarget): Promise<RepoAccess | undefined> {
    try {
      return await this.repos.access(target.host, target.slug);
    } catch (error) {
      if (!(error instanceof SignInRequiredError)) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Could not open {0}: {1}', target.slug, error instanceof Error ? error.message : String(error)));
        return undefined;
      }
    }
    const signIn = vscode.l10n.t('Sign in to GitHub');
    const answer = await vscode.window.showInformationMessage(
      vscode.l10n.t('{0} was not found without signing in. If it is private, sign in to GitHub to open it.', target.slug),
      signIn,
    );
    if (answer !== signIn) return undefined;
    try {
      return await this.repos.access(target.host, target.slug, { signIn: true });
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Could not open {0}: {1}', target.slug, error instanceof Error ? error.message : String(error)));
      return undefined;
    }
  }
}

async function chooseSite(sites: RemoteSite[]): Promise<RemoteSite | undefined> {
  const picked = await vscode.window.showQuickPick(
    sites.map(site => ({ label: site.name, description: site.root || '/', site })),
    { title: vscode.l10n.t('This repository has more than one documentation site. Which one?') },
  );
  return picked?.site;
}

/** Pasta do workspace que é um clone do repositório (pelo remote do Git), se houver. */
export async function localClone(host: string, slug: string): Promise<vscode.Uri | undefined> {
  const api = await gitApi().catch(() => undefined);
  const same = (url?: string) => {
    const remote = url ? parseGitHubRemote(url) : undefined;
    return remote?.host === host && remote.slug.toLowerCase() === slug.toLowerCase();
  };
  return api?.repositories.find(repo => repo.state.remotes.some(r => same(r.fetchUrl) || same(r.pushUrl)))?.rootUri;
}

async function openLocal(root: vscode.Uri, path: string | undefined): Promise<vscode.Uri | undefined> {
  if (!path || !/\.md$/i.test(path)) {
    void vscode.commands.executeCommand('workbench.view.extension.techdocs');
    return undefined;
  }
  const uri = vscode.Uri.joinPath(root, path);
  await vscode.commands.executeCommand('vscode.open', uri);
  return uri;
}
