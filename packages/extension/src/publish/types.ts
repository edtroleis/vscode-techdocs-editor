/**
 * O que o painel de publicação usa do Git e da página, sem `vscode`: em produção, o `vscode.git` e o
 * documento aberto (`vscodeGit.ts`); nos testes unitários, versões simuladas (D3-1 da spec 00).
 * Caminhos sempre relativos à raiz do repositório, com `/`.
 */

export interface LocalGit {
  /** Relê o estado do repositório (depois de salvar um arquivo, antes de ver o que mudou). */
  refresh(): Promise<void>;
  /** URL do remote `origin` (ou do primeiro remote). */
  remoteUrl(): string | undefined;
  /** Branch atual; undefined com HEAD solto. */
  currentBranch(): string | undefined;
  /** SHA do commit atual. */
  headSha(): string | undefined;
  headMessage(): Promise<string>;
  hasLocalBranch(name: string): Promise<boolean>;
  /** Dos `paths`, os que têm alteração (no índice, na árvore de trabalho ou ainda não versionados). */
  changed(paths: string[]): string[];
  /** Arquivos no índice (staged) fora de `paths`: um commit levaria junto. */
  stagedOutside(paths: string[]): string[];
  /** Cria a branch a partir do HEAD e troca para ela (as alterações não commitadas vão junto). */
  createBranch(name: string): Promise<void>;
  checkout(name: string): Promise<void>;
  deleteBranch(name: string): Promise<void>;
  /** Commit só de `paths`. */
  commit(paths: string[], message: string): Promise<void>;
  commitEmpty(message: string): Promise<void>;
  /** Push da branch para o remote, com upstream. */
  push(branch: string): Promise<void>;
  /** Descarta as alterações não commitadas de `paths`. */
  discardChanges(paths: string[]): Promise<void>;
}

export interface PageDoc {
  /** Caminho da página no repositório. */
  readonly path: string;
  /** Pasta das docs no repositório (imagens em `<docsDir>/assets/`). */
  readonly docsDir: string;
  text(): string;
  readonly dirty: boolean;
  save(): Promise<void>;
  /** Troca o texto inteiro (correções automáticas do lint). */
  replaceText(text: string): Promise<void>;
  /** Volta ao que está no disco, sem salvar. */
  revert(): Promise<void>;
}
