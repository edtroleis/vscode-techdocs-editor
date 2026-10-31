import * as vscode from 'vscode';
import { bringIntoDocs, mkdocsRepoUrl, parseGitHubRemote, repoFileUrl } from '@edtroleis/techdocs-editor-core';
import { repoDirOf } from './chooseSites';

/**
 * Um Markdown de fora do `docs_dir` (o README) trazido como página `page` (spec 04): os links acertados e as imagens
 * de fora copiadas para `<docs_dir>/assets/`. Os outros arquivos de fora viram o endereço deles no repositório (o
 * `repo_url` do `mkdocs.yml`, senão o `origin` do Git, na branch principal); sem endereço, viram texto com o caminho
 * (`asText`), menos as definições de referência (`left`).
 * Não grava nada: `images` diz o que copiar (`copyImages`).
 */
export async function bringFileIntoDocs(file: vscode.Uri, text: string, page: vscode.Uri, docsDir: vscode.Uri, yml: string | undefined) {
  const repo = (await repoDirOf(file)) ?? vscode.workspace.getWorkspaceFolder(file)?.uri ?? vscode.Uri.joinPath(file, '..');
  const rel = (uri: vscode.Uri) => uri.path.slice(repo.path.replace(/\/$/, '').length + 1);
  const base = mkdocsRepoUrl(yml) ?? (await originUrl(repo));
  const branch = base ? await defaultBranch(repo) : 'main';
  const assets = vscode.Uri.joinPath(docsDir, 'assets');
  const existing = await vscode.workspace.fs.readDirectory(assets).then(
    list => list.map(([name]) => `${rel(assets)}/${name}`),
    () => [],
  );
  const brought = bringIntoDocs(text, {
    from: rel(file),
    to: rel(page),
    docsDir: rel(docsDir),
    fileUrl: base ? path => repoFileUrl(base, branch, path) : undefined,
    taken: new Set(existing),
  });
  return {
    text: brought.text,
    images: brought.images.map(({ from, to }) => ({ from: vscode.Uri.joinPath(repo, from), to: vscode.Uri.joinPath(repo, to) })),
    asText: brought.asText,
    left: brought.left,
  };
}

/** Copia as imagens (as que não existem mais na origem ficam de fora). */
export async function copyImages(images: ReadonlyArray<{ from: vscode.Uri; to: vscode.Uri }>) {
  for (const { from, to } of images) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(to, '..'));
    await vscode.workspace.fs.copy(from, to, { overwrite: false }).then(undefined, () => undefined);
  }
}

/** `https://host/dono/repo` pelo `origin` do `.git/config` (sem a extensão Git: também no navegador). */
async function originUrl(repo: vscode.Uri): Promise<string | undefined> {
  const config = await readText(vscode.Uri.joinPath(repo, '.git', 'config'));
  const url = config?.match(/\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/)?.[1];
  const remote = url ? parseGitHubRemote(url) : undefined;
  return remote && `https://${remote.host}/${remote.slug}`;
}

/** A branch principal pelo `origin/HEAD` do Git; sem ele, `main`. */
async function defaultBranch(repo: vscode.Uri): Promise<string> {
  const head = await readText(vscode.Uri.joinPath(repo, '.git', 'refs', 'remotes', 'origin', 'HEAD'));
  return head?.match(/refs\/remotes\/origin\/(\S+)/)?.[1] ?? 'main';
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}
