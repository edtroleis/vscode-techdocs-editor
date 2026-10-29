import * as vscode from 'vscode';
import {
  DEFAULT_BRANCH_PATTERN,
  entryAt,
  listDir,
  loadRemoteSession,
  parseRemoteUri,
  REMOTE_SCHEME,
  RemotePageNotFoundError,
  remoteUriPath,
  siteOfPath,
  type RemoteSession,
} from '@edtroleis/techdocs-editor-core';
import { type RemoteRepos, SignInRequiredError } from './remoteRepos';

/** URI de um arquivo (ou da raiz, com `path` vazio) de um repositório aberto do GitHub. */
export const remoteUri = (host: string, slug: string, path: string) =>
  vscode.Uri.from({ scheme: REMOTE_SCHEME, authority: host, path: remoteUriPath(slug, path) });

/**
 * O esquema `techdocs:` (M2, fase 4b): `techdocs://<host>/<dono>/<repo>/<caminho>`, lido pela API do GitHub,
 * sem clone. As páginas vêm do rascunho da pessoa, se existir, senão da branch principal. Por enquanto, só
 * leitura: salvar o rascunho é a 4c.
 */
export class RemoteFileSystem implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;
  /** A última leitura de cada página: de que branch e de que SHA veio o texto (o salvar da 4c parte dela). */
  private readonly sessions = new Map<string, RemoteSession>();

  constructor(private readonly repos: RemoteRepos) {}

  /** Sessão da última leitura da página (undefined se ela não foi lida). */
  session(uri: vscode.Uri): RemoteSession | undefined {
    return this.sessions.get(uri.toString());
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { access, path } = await this.resolve(uri);
    const entry = entryAt(access.files, path);
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
    return {
      type: entry.type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: entry.type === 'file' ? entry.size : 0,
      permissions: vscode.FilePermission.Readonly,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { access, path } = await this.resolve(uri);
    if (entryAt(access.files, path)?.type !== 'dir') throw vscode.FileSystemError.FileNotADirectory(uri);
    return listDir(access.files, path).map(([name, type]) => [name, type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { access, path } = await this.resolve(uri);
    if (/\.md$/i.test(path)) {
      const site = siteOfPath(access.sites, path);
      const branchPattern = vscode.workspace.getConfiguration('techdocsEditor').get<string>('branchPattern') || DEFAULT_BRANCH_PATTERN;
      try {
        const session = await loadRemoteSession(
          access.client,
          { filePath: path, docsDir: site?.docsDir ?? path.split('/').slice(0, -1).join('/') },
          { login: access.login, branchPattern },
        );
        this.sessions.set(uri.toString(), session);
        return new TextEncoder().encode(session.content);
      } catch (error) {
        if (error instanceof RemotePageNotFoundError) throw vscode.FileSystemError.FileNotFound(uri);
        throw error;
      }
    }
    // Imagens e outros arquivos: da branch principal (as do rascunho entram com o salvar, na 4c)
    const entry = entryAt(access.files, path);
    if (entry?.type !== 'file') throw vscode.FileSystemError.FileNotFound(uri);
    return access.client.getBlobBytes(entry.sha);
  }

  writeFile(uri: vscode.Uri): never {
    throw this.readOnly(uri);
  }

  createDirectory(uri: vscode.Uri): never {
    throw this.readOnly(uri);
  }

  delete(uri: vscode.Uri): never {
    throw this.readOnly(uri);
  }

  rename(uri: vscode.Uri): never {
    throw this.readOnly(uri);
  }

  private readOnly(uri: vscode.Uri) {
    return vscode.FileSystemError.NoPermissions(
      vscode.l10n.t('{0} is open from GitHub as read-only.', parseRemoteUri(uri.authority, uri.path)?.slug ?? uri.toString()),
    );
  }

  private async resolve(uri: vscode.Uri) {
    const target = parseRemoteUri(uri.authority, uri.path);
    if (!target) throw vscode.FileSystemError.FileNotFound(uri);
    try {
      return { access: await this.repos.access(target.host, target.slug), path: target.path };
    } catch (error) {
      if (error instanceof SignInRequiredError) {
        throw vscode.FileSystemError.NoPermissions(vscode.l10n.t('Sign in to GitHub to open {0}.', target.slug));
      }
      throw error;
    }
  }
}
