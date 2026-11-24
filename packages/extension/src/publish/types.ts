import type { FileChange } from '@edtroleis/techdocs-editor-core';
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
  /** Todos os arquivos com alteração ou ainda não versionados. */
  changedFiles(): string[];
  /** O arquivo já está no Git (não é novo). */
  tracked(path: string): boolean;
  /** Arquivos no índice (staged) fora de `paths`: um commit levaria junto. */
  stagedOutside(paths: string[]): string[];
  /** Cria a branch a partir do HEAD (ou de `from`) e troca para ela (as alterações não commitadas vão junto). */
  createBranch(name: string, from?: string): Promise<void>;
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

/** O Git do repositório inteiro, para o envio (spec 09). */
export interface RepoGit extends LocalGit {
  /** Caminho da raiz no disco. */
  readonly root: string;
  /** A branch principal do `origin` (o `origin/HEAD`); undefined sem `origin`. */
  defaultBranch(): string | undefined;
  fetch(): Promise<void>;
  /** Arquivos diferentes entre `ref` e o HEAD + árvore de trabalho + não versionados, pelo conteúdo. */
  diffWith(ref: string): Promise<FileChange[]>;
  /** Merge de `ref` na branch atual; os caminhos em conflito ([] = juntou sozinho). */
  merge(ref: string): Promise<string[]>;
  /** Volta `paths` ao conteúdo de `ref` (o que não existe em `ref` é apagado), sem commit. */
  restoreFrom(ref: string, paths: string[]): Promise<void>;
  /**
   * Volta à `branch` levando as mudanças contra `base` como não commitadas. Se a `branch` mudou um desses arquivos
   * desde a `base`, não mexe em nada e devolve os caminhos (nada se perde).
   */
  unstackOnto(branch: string, base: string): Promise<string[]>;
  addRemote(name: string, url: string): Promise<void>;
  /** Nome e e-mail do Git que valem neste repositório (o do repositório, senão o global). */
  identity(): Promise<{ name?: string; email?: string }>;
}

export interface PageDoc {
  /** Caminho da página no repositório. */
  readonly path: string;
  /** Pasta das docs no repositório (imagens em `<docsDir>/assets/`). */
  readonly docsDir: string;
  /** O `mkdocs.yml` do site, no repositório: vai junto com a página quando ela precisa dele (site ou página novos). */
  readonly mkdocs?: string;
  text(): string;
  readonly dirty: boolean;
  save(): Promise<void>;
  /** Troca o texto inteiro (correções automáticas do lint). */
  replaceText(text: string): Promise<void>;
  /** Volta ao que está no disco, sem salvar. */
  revert(): Promise<void>;
}
