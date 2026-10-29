import type { GitHubClient } from './github';
import type { RemoteSite } from './remoteSession';

/**
 * Os arquivos de um repositório lidos pela API (fase 4b): o que o `FileSystemProvider` do esquema `techdocs:`
 * responde a `stat` e `readDirectory`, sem `vscode`.
 */

export type RepoTreeFile = { path: string; sha: string; size: number };
export type RepoEntry = { type: 'file'; sha: string; size: number } | { type: 'dir' };

/** Os arquivos do commit de `ref` (branch, tag ou SHA), com as subpastas; vazio se a ref não existe. */
export async function loadRepoFiles(client: GitHubClient, ref: string): Promise<RepoTreeFile[]> {
  const commit = await client.getCommit(ref);
  if (!commit) return [];
  return (await client.getTree(commit.tree)).files;
}

/** Arquivo ou pasta no caminho (`''` é a raiz); undefined se não há nada lá. */
export function entryAt(files: readonly RepoTreeFile[], path: string): RepoEntry | undefined {
  if (!path) return { type: 'dir' };
  const file = files.find(f => f.path === path);
  if (file) return { type: 'file', sha: file.sha, size: file.size };
  return files.some(f => f.path.startsWith(`${path}/`)) ? { type: 'dir' } : undefined;
}

/** Nomes de uma pasta (`''` é a raiz): as subpastas primeiro, depois os arquivos, cada grupo em ordem. */
export function listDir(files: readonly RepoTreeFile[], path: string): Array<[string, 'file' | 'dir']> {
  const prefix = path ? `${path}/` : '';
  const dirs = new Set<string>();
  const names: string[] = [];
  for (const { path: filePath } of files) {
    if (!filePath.startsWith(prefix)) continue;
    const [name, ...rest] = filePath.slice(prefix.length).split('/');
    if (rest.length) dirs.add(name);
    else names.push(name);
  }
  return [...[...dirs].sort().map(name => [name, 'dir'] as [string, 'dir']), ...names.sort().map(name => [name, 'file'] as [string, 'file'])];
}

/** Site de que a página faz parte (está no `docs_dir` dele); com sites aninhados, o mais interno. */
export function siteOfPath(sites: readonly RemoteSite[], path: string): RemoteSite | undefined {
  return sites.filter(site => path.startsWith(`${site.docsDir}/`)).sort((a, b) => b.docsDir.length - a.docsDir.length)[0];
}
