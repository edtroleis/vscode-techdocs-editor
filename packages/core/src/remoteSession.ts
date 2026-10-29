import type { Configuration } from 'markdownlint';
import { docsTree, pageTitle, siteName, type DocsTree } from './docsTree';
import { GitHubClient, type PullRequest, type Repo } from './github';
import { DEFAULT_LINT_CONFIG, LINT_CONFIG_FILES, parseLintConfig } from './lint';
import { docsDirFromMkdocs, pageFileCandidates } from './mkdocs';
import { branchFor } from './publish';
import { loadRepoConfig, type RepoConfig } from './repoConfig';

/**
 * Modo remoto (spec 02, M1, M2 e M8; fase 4a): a documentação lida direto do GitHub, sem clone. É o
 * `loadSession` do plugin sem a entidade do Backstage: o site vem da pasta do `mkdocs.yml` no repositório.
 */

/** Pastas ignoradas ao procurar `mkdocs.yml` (as mesmas do modo local). */
const IGNORED = /(^|\/)(node_modules|\.git|site|\.venv)\//;

const join = (...parts: string[]) => parts.filter(Boolean).join('/');

/** Um site do MkDocs no repositório. `root`: a pasta do `mkdocs.yml` ('' na raiz). */
export type RemoteSite = {
  root: string;
  /** Pasta das docs no repositório (ex.: "docs" ou "servico/docs"). */
  docsDir: string;
  name: string;
  yml: string;
};

/** O site com as páginas: os `.md` do `docs_dir` (relativos a ele) e a árvore do menu. */
export type RemoteSiteTree = RemoteSite & { pages: string[]; tree: DocsTree };

/** Tudo o que o editor precisa saber sobre a página aberta no modo remoto. */
export type RemoteSession = {
  repo: Repo;
  /** Login do GitHub; undefined na leitura sem login (repositório público, A-1). */
  login?: string;
  filePath: string;
  docsDir: string;
  /** Branch do rascunho: uma por pessoa e por página (D4-3). Sem login, undefined. */
  branch?: string;
  hasBranch: boolean;
  /** O texto exatamente como está no arquivo (do rascunho, se existir; senão da branch principal). */
  content: string;
  contentSha: string;
  /**
   * Commit da branch principal de onde o texto foi lido quando ainda não há rascunho. O rascunho nasce dele
   * (e não da principal do momento de salvar): se alguém publicar antes, o editor junta depois, sem sobrescrever.
   */
  mainSha: string;
  pr: PullRequest | null;
  requiredApprovals: number;
  /** Checks que a branch principal exige para o merge (vazio: nenhum obrigatório). */
  requiredChecks: string[];
  /** O repositório tem workflows do GitHub Actions. */
  hasWorkflows: boolean;
  /** Configuração do markdownlint do repositório (a mesma que a pipeline usa). */
  lintConfig: Configuration;
  repoConfig: RepoConfig;
};

/** A página não existe no repositório. */
export class RemotePageNotFoundError extends Error {
  constructor(readonly filePath: string) {
    super(`File ${filePath} not found`);
    this.name = 'RemotePageNotFoundError';
  }
}

/** A branch do rascunho existe, mas sem o arquivo da página. */
export class RemoteDraftFileMissingError extends Error {
  constructor(readonly filePath: string, readonly branch: string) {
    super(`File ${filePath} does not exist in draft ${branch}`);
    this.name = 'RemoteDraftFileMissingError';
  }
}

/** Arquivos da árvore de um commit (branch, tag ou SHA); a árvore vazia se a ref não existe. */
async function treeFiles(client: GitHubClient, ref: string) {
  const commit = await client.getCommit(ref);
  if (!commit) return [];
  return (await client.getTree(commit.tree)).files;
}

/** Os sites do repositório em `ref`: cada `mkdocs.yml` fora das pastas ignoradas, na ordem das pastas. */
export async function findRemoteSites(client: GitHubClient, ref: string): Promise<RemoteSite[]> {
  const files = await treeFiles(client, ref);
  const roots = files
    .map(f => f.path)
    .filter(path => /(^|\/)mkdocs\.ya?ml$/.test(path) && !IGNORED.test(path))
    .sort();
  const sites = await Promise.all(
    roots.map(async path => {
      const file = await client.getFile(path, ref);
      const root = path.split('/').slice(0, -1).join('/');
      const yml = file?.content ?? '';
      return { root, docsDir: join(root, docsDirFromMkdocs(yml)), name: siteName(yml) ?? (root || client.slug), yml };
    }),
  );
  return sites;
}

/**
 * As páginas e o menu do site em `ref`. Os títulos vêm do `nav`; páginas fora dele levam o título da
 * página só se `titles` (lê cada uma: uma chamada por página), senão o nome do arquivo.
 */
export async function loadRemoteSiteTree(
  client: GitHubClient,
  site: RemoteSite,
  ref: string,
  { titles = false }: { titles?: boolean } = {},
): Promise<RemoteSiteTree> {
  const prefix = `${site.docsDir}/`;
  const files = (await treeFiles(client, ref)).filter(f => f.path.startsWith(prefix) && /\.md$/i.test(f.path));
  const pages = files.map(f => f.path.slice(prefix.length)).sort();
  const found = new Map<string, string | undefined>();
  if (titles) {
    await Promise.all(files.map(async f => found.set(f.path.slice(prefix.length), pageTitle(await client.getBlob(f.sha)))));
  }
  return { ...site, pages, tree: docsTree(site.yml, pages, path => found.get(path)) };
}

/** Arquivo de uma página do TechDocs (caminho da URL do site), na ordem em que o MkDocs resolve; null se não há. */
export async function findRemotePage(client: GitHubClient, site: RemoteSite, page: string, ref: string): Promise<string | null> {
  for (const candidate of pageFileCandidates(site.docsDir, page)) {
    if (await client.getFile(candidate, ref)) return candidate;
  }
  return null;
}

/** Primeiro arquivo de configuração do markdownlint na raiz do repositório (como o markdownlint-cli2). */
async function loadLintConfig(client: GitHubClient, ref: string): Promise<Configuration> {
  for (const name of LINT_CONFIG_FILES) {
    const file = await client.getFile(name, ref);
    if (!file) continue;
    try {
      return parseLintConfig(name, file.content);
    } catch {
      // Configuração inválida: a pipeline também falharia; aqui segue com as regras padrão
      return DEFAULT_LINT_CONFIG;
    }
  }
  return DEFAULT_LINT_CONFIG;
}

/**
 * A página no repositório: do rascunho da pessoa, se existir, senão da branch principal (M2). Sem `login`
 * (leitura sem conta), só a branch principal, sem PR e sem permissão de escrita.
 */
export async function loadRemoteSession(
  client: GitHubClient,
  { filePath, docsDir }: { filePath: string; docsDir: string },
  { login, branchPattern }: { login?: string; branchPattern?: string } = {},
): Promise<RemoteSession> {
  const repo = await client.getRepo();
  const branch = login ? branchFor(login, filePath, branchPattern) : undefined;
  const [branchSha, mainSha, pr, rules, hasWorkflows, lintConfig, repoConfig] = await Promise.all([
    branch ? client.getBranchSha(branch) : null,
    client.getBranchSha(repo.defaultBranch),
    branch ? client.findOpenPullRequest(branch) : null,
    // Sem login, as regras da branch podem não ser legíveis: nenhuma exigência conhecida
    client.getBranchRules(repo.defaultBranch).catch(() => ({ requiresPullRequest: false, requiredApprovals: 0, requiredChecks: [] as string[] })),
    // Sem permissão para listar workflows: supõe que há pipeline (o caso mais comum)
    client.hasWorkflows().catch(() => true),
    loadLintConfig(client, repo.defaultBranch),
    loadRepoConfig(client, repo.defaultBranch),
  ]);
  if (!mainSha) throw new RemotePageNotFoundError(filePath);
  const file = await client.getFile(filePath, branchSha ? branch! : mainSha);
  if (!file) {
    if (branchSha) throw new RemoteDraftFileMissingError(filePath, branch!);
    throw new RemotePageNotFoundError(filePath);
  }
  return {
    repo: login ? repo : { ...repo, canWrite: false, isAdmin: false },
    login,
    filePath,
    docsDir,
    branch,
    hasBranch: Boolean(branchSha),
    content: file.content,
    contentSha: file.sha,
    mainSha,
    pr,
    requiredApprovals: rules.requiredApprovals,
    requiredChecks: rules.requiredChecks,
    hasWorkflows,
    lintConfig,
    repoConfig,
  };
}
