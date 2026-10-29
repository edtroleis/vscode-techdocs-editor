import { DEFAULT_BRANCH_PATTERN } from './publish';
import type { GitHubClient } from './github';

/** Um rascunho da pessoa ("Minhas alterações"): a página e em que pé está. */
export type MyDraft = {
  branch: string;
  /** Caminho da página no repositório. */
  page: string;
  /** `draft`: ainda não foi pedida revisão (ou o pedido está em rascunho); `review`: esperando revisão. */
  state: 'draft' | 'review';
  pr?: { number: number; url: string };
};

/**
 * Os rascunhos da pessoa num repositório: as branches do padrão dela (`docs/{login}/…`) que ainda mudam uma
 * página em relação à principal. Branch já publicada (sem diferença) fica de fora.
 */
export async function listMyDrafts(
  client: GitHubClient,
  { login, defaultBranch, pattern = DEFAULT_BRANCH_PATTERN, isPage }: { login: string; defaultBranch: string; pattern?: string; isPage: (path: string) => boolean },
): Promise<MyDraft[]> {
  const prefix = pattern.split('{path}')[0].replace('{login}', login);
  // Padrão sem `{path}` no fim (raro): não dá para saber quais branches são rascunhos
  if (!pattern.includes('{path}') || !prefix) return [];
  const branches = await client.listBranches(prefix);
  const drafts = await Promise.all(
    branches.map(async (branch): Promise<MyDraft | undefined> => {
      const [pr, diff] = await Promise.all([client.findOpenPullRequest(branch), client.compare(defaultBranch, branch)]);
      const page = diff.files.find(f => !f.removed && isPage(f.path));
      if (!page) return undefined;
      return {
        branch,
        page: page.path,
        state: pr && !pr.draft ? 'review' : 'draft',
        pr: pr ? { number: pr.number, url: pr.htmlUrl } : undefined,
      };
    }),
  );
  return drafts.filter((d): d is MyDraft => Boolean(d)).sort((a, b) => a.page.localeCompare(b.page));
}
