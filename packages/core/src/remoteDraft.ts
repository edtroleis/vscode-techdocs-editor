import { GitHubClient, GitHubError } from './github';
import type { RemoteSession } from './remoteSession';
import { SKIP_CI } from './syncMain';

/**
 * Salvar no modo remoto (fase 4c, M3 e M6): Ctrl+S grava o rascunho da página, um commit na branch da pessoa
 * (D4-3), criada na primeira vez a partir do commit da branch principal em que o texto foi lido. O commit vai
 * sobre o SHA lido: se a página mudou no rascunho por outro caminho, o GitHub recusa (a 4e resolve).
 */

/** Sem login não há rascunho: a página está aberta só para leitura. */
export class RemoteReadOnlyError extends Error {
  constructor(readonly filePath: string) {
    super(`${filePath} is read-only: sign in to GitHub to save`);
    this.name = 'RemoteReadOnlyError';
  }
}

/** A página mudou no rascunho depois que foi lida (outra janela, outra pessoa com o mesmo login). */
export class RemoteDraftChangedError extends Error {
  constructor(readonly filePath: string, readonly branch: string) {
    super(`${filePath} changed in ${branch} after it was read`);
    this.name = 'RemoteDraftChangedError';
  }
}

/** A branch do rascunho, criada se ainda não existe (do commit da principal em que o texto foi lido). */
async function ensureDraftBranch(client: GitHubClient, session: RemoteSession): Promise<RemoteSession & { branch: string }> {
  const { branch } = session;
  if (!branch || !session.repo.canWrite) throw new RemoteReadOnlyError(session.filePath);
  if (!session.hasBranch) {
    try {
      await client.createBranch(branch, session.mainSha);
    } catch (error) {
      // Criada enquanto isso (outra aba): o commit sobre o SHA lido diz se dá para gravar
      if (!(error instanceof GitHubError && error.status === 422)) throw error;
    }
  }
  return { ...session, branch, hasBranch: true };
}

/**
 * Grava `content` no rascunho. `message` sem o `[skip ci]`: ele entra quando `skipCi` e o repositório tem
 * pipeline (o rascunho só guarda; quem verifica é o Salvar e verificar, na 4d). Texto igual ao lido: nenhum
 * commit (e nenhuma branch). Devolve a sessão atualizada e o SHA do commit.
 */
export async function saveRemoteDraft(
  client: GitHubClient,
  session: RemoteSession,
  content: string,
  { message, skipCi = true }: { message: string; skipCi?: boolean },
): Promise<{ session: RemoteSession; commitSha?: string }> {
  if (content === session.content) return { session };
  const draft = await ensureDraftBranch(client, session);
  const marker = skipCi && session.hasWorkflows ? ` ${SKIP_CI}` : '';
  try {
    const saved = await client.putFile(session.filePath, draft.branch, content, session.contentSha, message + marker);
    return { session: { ...draft, content, contentSha: saved.sha }, commitSha: saved.commitSha };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 409) throw new RemoteDraftChangedError(session.filePath, draft.branch);
    throw error;
  }
}

/** Grava uma imagem (em base64) em `path` no rascunho da página (M6). Devolve a sessão com a branch. */
export async function saveRemoteImage(
  client: GitHubClient,
  session: RemoteSession,
  path: string,
  base64: string,
  { message, skipCi = true }: { message: string; skipCi?: boolean },
): Promise<RemoteSession> {
  const draft = await ensureDraftBranch(client, session);
  await client.putBinary(path, draft.branch, base64, message + (skipCi && session.hasWorkflows ? ` ${SKIP_CI}` : ''));
  return draft;
}
