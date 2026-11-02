import * as vscode from 'vscode';

/** Diretórios que nunca têm páginas do site. */
const SKIPPED = new Set(['.git', 'node_modules']);

/**
 * Os arquivos dentro do diretório (e dos subdiretórios), lidos direto do disco. Substitui o `findFiles` para o
 * `docs_dir`: com o workspace aberto num diretório grande (o ~), a busca do VS Code percorre muito mais que as
 * docs e leva segundos; o `docs_dir` é pequeno e lido assim leva milissegundos. `md`: só as páginas.
 */
export async function filesUnder(dir: vscode.Uri, md = false): Promise<vscode.Uri[]> {
  const entries = await vscode.workspace.fs.readDirectory(dir).then(
    list => list,
    () => [] as [string, vscode.FileType][],
  );
  const nested = await Promise.all(
    entries.map(async ([name, type]): Promise<vscode.Uri[]> => {
      const uri = vscode.Uri.joinPath(dir, name);
      // Um link para um diretório pode apontar para um acima (um laço): fica de fora
      if (type & vscode.FileType.Directory) return SKIPPED.has(name) || type & vscode.FileType.SymbolicLink ? [] : filesUnder(uri, md);
      return !md || /\.md$/i.test(name) ? [uri] : [];
    }),
  );
  return nested.flat();
}
