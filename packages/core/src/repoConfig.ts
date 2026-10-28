import { parse as parseYaml, parseDocument } from 'yaml';
import type { GitHubClient } from './github';

/**
 * Configuração do editor no próprio repositório da documentação, na raiz da branch principal: cada
 * time descreve a sua pipeline sem mexer no app-config do portal. Vale sobre o app-config; a anotação
 * `techdocs-editor/verification` do catálogo vale sobre as duas.
 *
 * ```yaml
 * verification:
 *   mode: pipeline            # auto | pipeline | editor
 *   startTimeoutSeconds: 600  # fila do CI demora para começar
 *   checkHelp:                # mensagem em linguagem simples por nome de job (somada às do portal)
 *     build: A documentação não pôde ser montada.
 * catalog: off                # auto | required | off: o catalog-info.yaml na conferência (spec 04)
 * ```
 */
export const REPO_CONFIG_FILE = '.techdocs-editor.yaml';

export type VerificationMode = 'auto' | 'pipeline' | 'editor';

/**
 * O `catalog-info.yaml` na conferência do repositório: `auto` confere a anotação se o arquivo existe (sem ele, só
 * uma dica), `required` exige o arquivo (o Backstage lê o do repositório) e `off` não fala dele (o Backstage
 * registra a documentação de outro jeito).
 */
export type CatalogMode = 'auto' | 'required' | 'off';

export const CATALOG_MODES: CatalogMode[] = ['auto', 'required', 'off'];

export type RepoConfig = {
  verification: {
    mode?: VerificationMode;
    startTimeoutSeconds?: number;
    checkHelp: Record<string, string>;
  };
  catalog?: CatalogMode;
};

export const EMPTY_REPO_CONFIG: RepoConfig = { verification: { checkHelp: {} } };

const MODES: VerificationMode[] = ['auto', 'pipeline', 'editor'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Lê o `.techdocs-editor.yaml`. Campo com valor inválido é ignorado (vale o do portal), para um erro
 * de digitação num repositório não travar o editor; YAML que não abre também.
 */
export function parseRepoConfig(text: string): RepoConfig {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch {
    return EMPTY_REPO_CONFIG;
  }
  const verification = isRecord(data) && isRecord(data.verification) ? data.verification : {};
  const { mode, startTimeoutSeconds, checkHelp } = verification;
  const catalog = isRecord(data) ? data.catalog : undefined;
  return {
    ...(CATALOG_MODES.includes(catalog as CatalogMode) && { catalog: catalog as CatalogMode }),
    verification: {
      mode: MODES.includes(mode as VerificationMode) ? (mode as VerificationMode) : undefined,
      startTimeoutSeconds:
        typeof startTimeoutSeconds === 'number' && startTimeoutSeconds > 0 ? startTimeoutSeconds : undefined,
      checkHelp: isRecord(checkHelp)
        ? Object.fromEntries(
            Object.entries(checkHelp).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          )
        : {},
    },
  };
}

/**
 * O `.techdocs-editor.yaml` com `catalog: <mode>` (undefined: o arquivo ainda não existe). O resto do arquivo,
 * comentários incluídos, fica como estava.
 */
export function setCatalogMode(text: string | undefined, mode: CatalogMode): string {
  if (!text?.trim()) return `catalog: ${mode}\n`;
  const doc = parseDocument(text);
  if (doc.errors.length || !isRecord(doc.toJS())) return `${text.replace(/\n*$/, '\n')}catalog: ${mode}\n`;
  doc.set('catalog', mode);
  return doc.toString({ lineWidth: 0 });
}

/** A configuração do repositório na branch `ref`; sem o arquivo, a vazia. */
export async function loadRepoConfig(client: GitHubClient, ref: string): Promise<RepoConfig> {
  const file = await client.getFile(REPO_CONFIG_FILE, ref);
  return file ? parseRepoConfig(file.content) : EMPTY_REPO_CONFIG;
}
