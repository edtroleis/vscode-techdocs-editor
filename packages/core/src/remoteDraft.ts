import { GitHubClient, GitHubError } from './github';
import { conflictCount, merge3, MergeChunk, resolveChunks } from './merge3';
import type { RemoteSession } from './remoteSession';
import { SKIP_CI } from './syncMain';

/**
 * Salvar no modo remoto (fase 4c, M3 e M6): Ctrl+S grava o rascunho da página, um commit na branch da pessoa
 * (D4-3), criada na primeira vez a partir do commit da branch principal em que o texto foi lido. O commit vai
 * sobre o SHA lido: se a página mudou no rascunho por outro caminho, o GitHub recusa (409) e o salvar junta
 * as duas versões (`merge3`, M5): sozinho o que não se sobrepõe; o resto, a pessoa escolhe (4e).
 */

/** Sem login não há rascunho: a página está aberta só para leitura. */
export class RemoteReadOnlyError extends Error {
  constructor(readonly filePath: string) {
    super(`${filePath} is read-only: sign in to GitHub to save`);
    this.name = 'RemoteReadOnlyError';
  }
}

/**
 * A página mudou no rascunho depois que foi lida (outra janela, outra pessoa com o mesmo login) e as duas
 * versões mudaram o mesmo trecho. `chunks`: o que juntar (`mine` é o texto sendo salvo, `theirs` o do
 * rascunho agora); `latest`: a sessão sobre a versão de agora, para gravar a resolução por cima dela.
 */
export class RemoteDraftChangedError extends Error {
  constructor(
    readonly filePath: string,
    readonly branch: string,
    readonly chunks: MergeChunk[],
    readonly latest: RemoteSession,
  ) {
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
): Promise<{ session: RemoteSession; commitSha?: string; merged?: boolean }> {
  if (content === session.content) return { session };
  const draft = await ensureDraftBranch(client, session);
  const marker = skipCi && session.hasWorkflows ? ` ${SKIP_CI}` : '';
  try {
    const saved = await client.putFile(session.filePath, draft.branch, content, session.contentSha, message + marker);
    return { session: { ...draft, content, contentSha: saved.sha }, commitSha: saved.commitSha };
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 409)) throw error;
  }
  // Mudou no rascunho depois da leitura: junta a versão lida, a desta pessoa e a de agora
  const theirs = await client.getFile(session.filePath, draft.branch);
  if (!theirs) throw new RemoteDraftChangedError(session.filePath, draft.branch, [], draft);
  const latest = { ...draft, content: theirs.content, contentSha: theirs.sha };
  const chunks = merge3(session.content, content, theirs.content);
  if (conflictCount(chunks)) throw new RemoteDraftChangedError(session.filePath, draft.branch, chunks, latest);
  const merged = resolveChunks(chunks, []);
  const saved = await client.putFile(session.filePath, draft.branch, merged, theirs.sha, message + marker);
  return { session: { ...latest, content: merged, contentSha: saved.sha }, commitSha: saved.commitSha, merged: true };
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

/** A página nova já existe na principal ou no rascunho dela (TP4: nunca sobrescreve). */
export class RemotePageExistsError extends Error {
  constructor(readonly filePath: string) {
    super(`${filePath} already exists`);
    this.name = 'RemotePageExistsError';
  }
}

/**
 * Página nova no modo remoto (TP10): um commit na branch do rascunho da página (`branch`, criada do commit
 * `mainSha` da principal) com a página e, se for o caso, o `mkdocs.yml` com ela no `nav` (`files`, caminho no
 * repositório → texto). Devolve o SHA do commit.
 */
export async function createRemotePage(
  client: GitHubClient,
  { branch, mainSha, filePath, files, message, skipCi }: { branch: string; mainSha: string; filePath: string; files: Record<string, string>; message: string; skipCi: boolean },
): Promise<string> {
  if (await client.getFile(filePath, mainSha)) throw new RemotePageExistsError(filePath);
  let head = await client.getBranchSha(branch);
  if (head && (await client.getFile(filePath, branch))) throw new RemotePageExistsError(filePath);
  if (!head) {
    await client.createBranch(branch, mainSha);
    head = mainSha;
  }
  const tree = await client.createTree(
    await client.getCommitTree(head),
    Object.entries(files).map(([path, content]) => ({ path, content })),
  );
  const commitSha = await client.createCommit(message + (skipCi ? ` ${SKIP_CI}` : ''), tree, [head]);
  await client.updateBranch(branch, commitSha);
  return commitSha;
}
