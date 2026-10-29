import * as vscode from 'vscode';
import {
  DEFAULT_BRANCH_PATTERN,
  entryAt,
  listDir,
  loadRemoteSession,
  pageTitle,
  parseRemoteUri,
  REMOTE_SCHEME,
  RemoteDraftChangedError,
  RemotePageNotFoundError,
  RemoteReadOnlyError,
  remoteUriPath,
  saveRemoteDraft,
  saveRemoteImage,
  siteOfPath,
  type RemoteSession,
} from '@edtroleis/techdocs-editor-core';
import { publishConfig } from '../publish/publishConfig';
import { type RepoAccess, type RemoteRepos, SignInRequiredError } from './remoteRepos';

/** URI de um arquivo (ou da raiz, com `path` vazio) de um repositório aberto do GitHub. */
export const remoteUri = (host: string, slug: string, path: string) =>
  vscode.Uri.from({ scheme: REMOTE_SCHEME, authority: host, path: remoteUriPath(slug, path) });

/**
 * O esquema `techdocs:` (M2, fase 4b): `techdocs://<host>/<dono>/<repo>/<caminho>`, lido pela API do GitHub,
 * sem clone. As páginas vêm do rascunho da pessoa, se existir, senão da branch principal. Salvar (Ctrl+S) grava
 * o rascunho (4c, M3): um commit na branch da pessoa, criada na primeira vez. Sem login ou sem permissão de
 * escrita, só leitura. As imagens enviadas vão para o rascunho e são lidas de lá (M6).
 */
export class RemoteFileSystem implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;
  private readonly conflictEmitter = new vscode.EventEmitter<{ uri: vscode.Uri; error: RemoteDraftChangedError }>();
  /** O Ctrl+S achou a página mudada no rascunho, no mesmo trecho: a pessoa escolhe (`resolveSave`). */
  readonly onDidConflict = this.conflictEmitter.event;
  /** A última leitura (ou gravação) de cada página: de que branch e de que SHA veio o texto; o salvar parte dela. */
  private readonly sessions = new Map<string, RemoteSession>();
  /** Arquivos que não estão na branch principal, lidos de um rascunho ou enviados agora (imagens). */
  private readonly drafts = new Map<string, Uint8Array>();
  /** "Data" de cada página relida (o VS Code só recarrega um documento aberto se ela muda). */
  private readonly versions = new Map<string, number>();

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
    const permissions = writable(access) ? undefined : vscode.FilePermission.Readonly;
    if (!entry) {
      const draft = await this.draftFile(uri, access, path);
      if (!draft) throw vscode.FileSystemError.FileNotFound(uri);
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: draft.byteLength, permissions };
    }
    return {
      type: entry.type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: 0,
      mtime: this.versions.get(uri.toString()) ?? 0,
      size: entry.type === 'file' ? entry.size : 0,
      permissions,
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
    // Imagens e outros arquivos: da branch principal, senão de um rascunho
    const entry = entryAt(access.files, path);
    if (entry?.type === 'file') return access.client.getBlobBytes(entry.sha);
    const draft = await this.draftFile(uri, access, path);
    if (!draft) throw vscode.FileSystemError.FileNotFound(uri);
    return draft;
  }

  /** Ctrl+S numa página: o rascunho (M3). Outros arquivos só entram pelo editor visual (`saveImage`). */
  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { access, path } = await this.resolve(uri);
    if (!/\.md$/i.test(path) || !writable(access)) throw this.readOnly(uri);
    const session = this.sessions.get(uri.toString()) ?? (await this.readFile(uri), this.sessions.get(uri.toString())!);
    const text = new TextDecoder().decode(content);
    const title = pageTitle(text) ?? path.split('/').pop()!.replace(/\.md$/i, '');
    try {
      const saved = await saveRemoteDraft(access.client, session, text, { message: vscode.l10n.t('docs: draft of "{0}"', title), skipCi: this.skipCi(uri) });
      this.sessions.set(uri.toString(), saved.session);
      // Juntado com o que mudou no rascunho (outro trecho): o editor passa a mostrar o texto gravado, depois
      // que o VS Code terminar o salvar
      if (saved.merged) setTimeout(() => void this.reload(uri), 200);
    } catch (error) {
      if (error instanceof RemoteDraftChangedError && error.chunks.length) this.conflictEmitter.fire({ uri, error });
      throw this.saveError(uri, error);
    }
  }

  /** Depois de resolver um conflito do salvar: a página passa a partir da versão de agora do rascunho. */
  rebase(uri: vscode.Uri, latest: RemoteSession) {
    this.sessions.set(uri.toString(), latest);
  }

  /**
   * Imagem enviada pelo editor visual da página `page` (M6): commit em `path` (relativo ao repositório) no
   * rascunho da página, criado se preciso. Fica guardada aqui para o editor mostrar sem ler de novo.
   */
  async saveImage(page: vscode.Uri, path: string, data: Uint8Array): Promise<void> {
    const { access } = await this.resolve(page);
    const session = this.sessions.get(page.toString());
    if (!session || !writable(access)) throw this.readOnly(page);
    try {
      const base64 = btoa(Array.from(data, b => String.fromCharCode(b)).join(''));
      const saved = await saveRemoteImage(access.client, session, path, base64, {
        message: vscode.l10n.t('docs: image for "{0}"', pageTitle(session.content) ?? session.filePath),
        skipCi: this.skipCi(page),
      });
      this.sessions.set(page.toString(), saved);
    } catch (error) {
      throw this.saveError(page, error);
    }
    this.drafts.set(remoteUri(page.authority, parseRemoteUri(page.authority, page.path)!.slug, path).toString(), data);
  }

  /**
   * Lê a página de novo do GitHub (depois de entrar no GitHub ou de descartar o rascunho) e avisa o VS Code,
   * que recarrega o documento aberto se ele não tem alteração não salva.
   */
  async reload(uri: vscode.Uri): Promise<void> {
    this.sessions.delete(uri.toString());
    this.versions.set(uri.toString(), Date.now());
    await this.readFile(uri);
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /** Dá para salvar a página (login com permissão de escrita no repositório). */
  canSave(uri: vscode.Uri): boolean {
    const session = this.sessions.get(uri.toString());
    return Boolean(session?.branch && session.repo.canWrite);
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

  /** Arquivo fora da branch principal: enviado agora ou num rascunho já salvo de uma página do repositório. */
  private async draftFile(uri: vscode.Uri, access: RepoAccess, path: string): Promise<Uint8Array | undefined> {
    const key = uri.toString();
    const known = this.drafts.get(key);
    if (known) return known;
    const prefix = uri.with({ path: remoteUriPath(parseRemoteUri(uri.authority, uri.path)!.slug, '') }).toString();
    const branches = new Set([...this.sessions].filter(([page, s]) => page.startsWith(prefix) && s.hasBranch && s.branch).map(([, s]) => s.branch!));
    for (const branch of branches) {
      const blob = await access.client.getRaw(path, branch);
      if (!blob) continue;
      const data = new Uint8Array(await blob.arrayBuffer());
      this.drafts.set(key, data);
      return data;
    }
    return undefined;
  }

  private skipCi(uri: vscode.Uri) {
    return publishConfig(vscode.workspace.getConfiguration('techdocsEditor', uri), undefined, vscode.env.language).skipCi;
  }

  private saveError(uri: vscode.Uri, error: unknown) {
    if (error instanceof RemoteReadOnlyError) return this.readOnly(uri);
    if (error instanceof RemoteDraftChangedError) {
      return new Error(vscode.l10n.t('This page changed in your draft ({0}) while you were editing it. Choose what stays in the passages that both versions changed.', error.branch));
    }
    return error;
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

/** Com login e permissão de escrita no repositório: as páginas podem ser salvas. */
const writable = (access: RepoAccess) => Boolean(access.login && access.repo.canWrite);
