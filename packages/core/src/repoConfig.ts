import { isMap, parse as parseYaml, parseDocument, type Scalar, type YAMLMap } from 'yaml';
import { parseTypes } from './attachments';
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
 * templates:
 *   repository: acme/docs-templates/templates   # os templates do time (spec 08), no formato da TA3
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
  /** O repositório de templates do time (spec 08, TR6): vence a configuração do usuário. */
  templates?: { repository: string };
  /** Imagens e anexos (spec 07): cada campo vale sozinho sobre a configuração do usuário. */
  attachments?: AttachmentsConfig;
};

/** Diretórios relativos ao `docs_dir`, limites em MB e as extensões aceitas. */
export type AttachmentsConfig = {
  images?: string;
  imagesMaxSizeMB?: number;
  imageTypes?: string[];
  files?: string;
  filesMaxSizeMB?: number;
  fileTypes?: string[];
};

const ATTACHMENT_KEYS = ['images', 'imagesMaxSizeMB', 'imageTypes', 'files', 'filesMaxSizeMB', 'fileTypes'] as const;

/** Diretório relativo, sem `/` nas pontas e sem subir (`..`); inválido: undefined. */
export function cleanDir(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length && !parts.some(p => p === '..' || p === '.') ? parts.join('/') : undefined;
}

/** Limite em MB: número maior que zero; inválido: undefined. */
export const cleanMaxMB = (value: unknown) => (typeof value === 'number' && value > 0 && Number.isFinite(value) ? value : undefined);

/** Extensões em lista YAML ou num texto separado por vírgula; recusadas e inválidas saem. */
export function cleanTypes(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return parseTypes(value.filter(v => typeof v === 'string').join(',')).types;
  return typeof value === 'string' ? parseTypes(value).types : undefined;
}

function parseAttachments(value: unknown): AttachmentsConfig | undefined {
  if (!isRecord(value)) return undefined;
  const out: AttachmentsConfig = {
    images: cleanDir(value.images),
    imagesMaxSizeMB: cleanMaxMB(value.imagesMaxSizeMB),
    imageTypes: cleanTypes(value.imageTypes),
    files: cleanDir(value.files),
    filesMaxSizeMB: cleanMaxMB(value.filesMaxSizeMB),
    fileTypes: cleanTypes(value.fileTypes),
  };
  const set = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as AttachmentsConfig;
  return Object.keys(set).length ? set : undefined;
}

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
  const repository = isRecord(data) && isRecord(data.templates) ? data.templates.repository : undefined;
  const attachments = isRecord(data) ? parseAttachments(data.attachments) : undefined;
  return {
    ...(attachments && { attachments }),
    ...(CATALOG_MODES.includes(catalog as CatalogMode) && { catalog: catalog as CatalogMode }),
    ...(typeof repository === 'string' && repository.trim() && { templates: { repository: repository.trim() } }),
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
 * O `.techdocs-editor.yaml` com `catalog: <mode>` (text undefined: o arquivo ainda não existe; mode undefined: tira o
 * `catalog`, e vale o da pessoa). O resto do arquivo, comentários incluídos, fica como estava.
 */
export function setCatalogMode(text: string | undefined, mode: CatalogMode | undefined): string {
  if (!text?.trim()) return mode ? `catalog: ${mode}\n` : (text ?? '');
  const doc = parseDocument(text);
  if (doc.errors.length || !isRecord(doc.toJS())) return mode ? `${text.replace(/\n*$/, '\n')}catalog: ${mode}\n` : text;
  if (mode) doc.set('catalog', mode);
  else {
    // O comentário de cima do arquivo fica preso na primeira chave: passa para a seguinte (ou o documento) antes
    const map = doc.contents as YAMLMap<Scalar, unknown>;
    const at = map.items.findIndex(pair => pair.key?.value === 'catalog');
    const comment = at >= 0 ? map.items[at].key?.commentBefore : undefined;
    if (comment) {
      const next = map.items[at + 1]?.key;
      if (next) next.commentBefore = next.commentBefore ? `${comment}\n${next.commentBefore}` : comment;
      else doc.commentBefore = comment;
    }
    doc.delete('catalog');
  }
  const out = doc.toString({ lineWidth: 0 });
  return out === '{}\n' ? '' : out;
}

/**
 * O `.techdocs-editor.yaml` com `templates.repository` (undefined no valor: tira, e o `templates:` vazio sai junto).
 * O resto do arquivo, comentários incluídos, fica como estava.
 */
export function setTemplatesRepository(text: string | undefined, repository: string | undefined): string {
  const doc = parseDocument(text?.trim() ? text : '');
  if (doc.errors.length || (text?.trim() && !isRecord(doc.toJS()))) {
    // Arquivo que não se lê: acrescenta no fim, mas nunca uma segunda chave `templates:` (o YAML ficaria pior)
    const appendable = repository && !/^templates\s*:/m.test(text ?? '');
    return appendable ? `${(text ?? '').replace(/\n*$/, '\n')}templates:\n  repository: ${repository}\n` : (text ?? '');
  }
  if (repository) doc.setIn(['templates', 'repository'], repository);
  else {
    doc.deleteIn(['templates', 'repository']);
    const rest = doc.get('templates', true);
    if (rest == null || (isMap(rest) && !rest.items.length)) doc.delete('templates');
  }
  const out = doc.toString({ lineWidth: 0 });
  return out === '{}\n' ? '' : out;
}

/**
 * O `.techdocs-editor.yaml` com os campos de `attachments` dados (undefined no valor: tira o campo; o `attachments:`
 * vazio sai junto). O resto do arquivo, comentários incluídos, fica como estava.
 */
export function setAttachments(text: string | undefined, fields: Partial<AttachmentsConfig>): string {
  const doc = parseDocument(text?.trim() ? text : '');
  if (doc.errors.length || (text?.trim() && !isRecord(doc.toJS()))) return text ?? '';
  for (const key of ATTACHMENT_KEYS) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (value === undefined) doc.deleteIn(['attachments', key]);
    else doc.setIn(['attachments', key], Array.isArray(value) ? doc.createNode(value, { flow: true }) : value);
  }
  const rest = doc.get('attachments', true);
  if (rest != null && isMap(rest) && !rest.items.length) doc.delete('attachments');
  const out = doc.toString({ lineWidth: 0 });
  return out === '{}\n' ? '' : out;
}

/** A configuração do repositório na branch `ref`; sem o arquivo, a vazia. */
export async function loadRepoConfig(client: GitHubClient, ref: string): Promise<RepoConfig> {
  const file = await client.getFile(REPO_CONFIG_FILE, ref);
  return file ? parseRepoConfig(file.content) : EMPTY_REPO_CONFIG;
}
