import {
  attachmentKind,
  attachmentLinkText,
  attachmentTarget,
  type AttachmentsConfig,
  cleanDir,
  cleanFileName,
  cleanMaxMB,
  cleanTypes,
  DEFAULT_FILE_TYPES,
  DEFAULT_FILES_DIR,
  DEFAULT_FILES_MAX_MB,
  DEFAULT_IMAGE_TYPES,
  DEFAULT_IMAGES_DIR,
  DEFAULT_IMAGES_MAX_MB,
  parseRepoConfig,
  REPO_CONFIG_FILE,
  setAttachments,
  withSuffix,
} from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import { repositoryFolder } from './catalogOptions';
import type { RepoCheck } from './repoCheck';
import { readText } from './templates/templateSources';

/**
 * Imagens e anexos (spec 07, revisada na 0.22): a configuração resolvida campo a campo (o `.techdocs-editor.yaml` do
 * repositório, depois as configurações do VS Code, depois o padrão) e a gravação no diretório certo, com o nome
 * limpo, reaproveitando o arquivo igual.
 */

export type AttachmentKey = keyof AttachmentsConfig;
export type AttachmentSettings = Required<AttachmentsConfig>;
export type AttachmentOrigin = 'repository' | 'settings' | 'default';

export const ATTACHMENT_DEFAULTS: AttachmentSettings = {
  images: DEFAULT_IMAGES_DIR,
  imagesMaxSizeMB: DEFAULT_IMAGES_MAX_MB,
  imageTypes: DEFAULT_IMAGE_TYPES,
  files: DEFAULT_FILES_DIR,
  filesMaxSizeMB: DEFAULT_FILES_MAX_MB,
  fileTypes: DEFAULT_FILE_TYPES,
};

/** A configuração do VS Code de cada campo (o limite das imagens continua em `images.maxSizeMB`). */
export const SETTING_OF: Record<AttachmentKey, string> = {
  images: 'attachments.images',
  imagesMaxSizeMB: 'images.maxSizeMB',
  imageTypes: 'attachments.imageTypes',
  files: 'attachments.files',
  filesMaxSizeMB: 'attachments.filesMaxSizeMB',
  fileTypes: 'attachments.fileTypes',
};

const CLEAN: Record<AttachmentKey, (value: unknown) => unknown> = {
  images: cleanDir,
  imagesMaxSizeMB: cleanMaxMB,
  imageTypes: cleanTypes,
  files: cleanDir,
  filesMaxSizeMB: cleanMaxMB,
  fileTypes: cleanTypes,
};

/** Valor de cada campo e de onde ele veio. Num workspace não confiável, só a configuração do usuário vale. */
export async function attachmentSettings(scope: vscode.Uri | undefined): Promise<{
  values: AttachmentSettings;
  from: Record<AttachmentKey, AttachmentOrigin>;
  folder: vscode.Uri | undefined;
}> {
  const folder = repositoryFolder(scope);
  const trusted = vscode.workspace.isTrusted;
  const team = trusted && folder ? parseRepoConfig((await readText(vscode.Uri.joinPath(folder, REPO_CONFIG_FILE))) ?? '').attachments ?? {} : {};
  const config = vscode.workspace.getConfiguration('techdocsEditor', scope);
  const values = { ...ATTACHMENT_DEFAULTS } as Record<AttachmentKey, unknown>;
  const from = {} as Record<AttachmentKey, AttachmentOrigin>;
  for (const key of Object.keys(ATTACHMENT_DEFAULTS) as AttachmentKey[]) {
    const inspect = config.inspect(SETTING_OF[key]);
    const own = CLEAN[key](trusted ? (inspect?.workspaceFolderValue ?? inspect?.workspaceValue ?? inspect?.globalValue) : inspect?.globalValue);
    if (team[key] !== undefined) [values[key], from[key]] = [team[key], 'repository'];
    else if (own !== undefined) [values[key], from[key]] = [own, 'settings'];
    else from[key] = 'default';
  }
  return { values: values as AttachmentSettings, from, folder };
}

/** Recusa com a razão e o que fazer (o aviso oferece abrir as Configurações quando o limite ou a lista resolvem). */
export class AttachmentRefused extends Error {
  constructor(
    message: string,
    readonly fixable: boolean,
  ) {
    super(message);
  }
}

export type SavedAttachment = { kind: 'image' | 'file'; link: string; text: string };

const attachedEmitter = new vscode.EventEmitter<{ page: vscode.Uri; file: vscode.Uri }>();
/** Arquivo gravado para a página (conta como citado por ela, mesmo antes de salvar: unusedAttachments.ts). */
export const onAttached = attachedEmitter.event;

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);

/**
 * Grava o arquivo escolhido para a página. `expect`: o botão de imagem só aceita imagem; File… aceita os dois (uma
 * imagem escolhida em File… entra como imagem). Mesmo nome e mesmo conteúdo: reaproveita; outro conteúdo: `-2`, `-3`…
 */
export async function saveAttachment(
  page: vscode.Uri,
  docsDir: string | undefined,
  name: string,
  data: Uint8Array,
  expect: 'image' | 'any',
): Promise<SavedAttachment> {
  const { values } = await attachmentSettings(page);
  const kind = attachmentKind(name, values);
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  if (kind === 'blocked') throw new AttachmentRefused(vscode.l10n.t('.{0} files are not accepted: {1}', extension, name), false);
  if (kind === 'notAllowed' || (expect === 'image' && kind !== 'image')) {
    throw new AttachmentRefused(
      expect === 'image'
        ? vscode.l10n.t('"{0}" is not one of the accepted images ({1}).', name, values.imageTypes.join(', '))
        : vscode.l10n.t('"{0}" is not one of the accepted types ({1}).', name, values.fileTypes.join(', ')),
      true,
    );
  }
  const maxMB = kind === 'image' ? values.imagesMaxSizeMB : values.filesMaxSizeMB;
  if (data.byteLength > maxMB * 1024 * 1024) {
    const size = (data.byteLength / 1024 / 1024).toLocaleString(vscode.env.language, { maximumFractionDigits: 1 });
    throw new AttachmentRefused(
      kind === 'image'
        ? vscode.l10n.t('"{0}" has {1} MB; the limit for images is {2} MB.', name, size, maxMB)
        : vscode.l10n.t('"{0}" has {1} MB; the limit for files is {2} MB.', name, size, maxMB),
      true,
    );
  }
  const clean = cleanFileName(name);
  for (let n = 1; ; n++) {
    const fileName = n === 1 ? clean : withSuffix(clean, n);
    const { path, link } = attachmentTarget(page.path, docsDir, kind === 'image' ? values.images : values.files, fileName);
    const uri = page.with({ path });
    const existing = await Promise.resolve(vscode.workspace.fs.readFile(uri)).then(
      bytes => bytes,
      () => undefined,
    );
    if (existing && !sameBytes(existing, data)) continue;
    if (!existing) await vscode.workspace.fs.writeFile(uri, data);
    attachedEmitter.fire({ page, file: uri });
    return { kind, link, text: kind === 'image' ? name.replace(/\.[^.]*$/, '') : attachmentLinkText(name, data.byteLength, vscode.env.language) };
  }
}

type Fields = Partial<Record<AttachmentKey, unknown>>;

/** Grava nas configurações do usuário (undefined tira). */
async function saveForMe(fields: Fields) {
  const config = vscode.workspace.getConfiguration('techdocsEditor');
  for (const [key, value] of Object.entries(fields)) await config.update(SETTING_OF[key as AttachmentKey], value, vscode.ConfigurationTarget.Global);
}

/**
 * A parte Imagens e anexos da janela Configurações: grava para o time (`attachments` no `.techdocs-editor.yaml`, com o
 * diff antes) ou só para a pessoa (nas configurações), e leva os campos de um lugar para o outro.
 */
export class AttachmentOptions {
  constructor(private readonly repoCheck: Pick<RepoCheck, 'proposeChange'>) {}

  async save(scope: vscode.Uri | undefined, where: 'team' | 'me', fields: Fields, quiet = false): Promise<boolean> {
    if (where === 'me') {
      await saveForMe(fields);
      return true;
    }
    const folder = repositoryFolder(scope);
    return Boolean(folder) && this.saveForTeam(folder!, fields, quiet);
  }

  /** Os campos que estão no outro lugar passam para `to` (e saem de onde estavam). */
  async move(scope: vscode.Uri | undefined, to: 'team' | 'me', quiet = false): Promise<boolean> {
    const { values, from, folder } = await attachmentSettings(scope);
    const moving = (Object.keys(from) as AttachmentKey[]).filter(key => from[key] === (to === 'team' ? 'settings' : 'repository'));
    if (!moving.length) return true;
    const fields = Object.fromEntries(moving.map(key => [key, values[key]]));
    const cleared = Object.fromEntries(moving.map(key => [key, undefined]));
    if (!folder) return false;
    if (to === 'team') {
      if (!(await this.saveForTeam(folder, fields, quiet))) return false;
      await saveForMe(cleared);
      return true;
    }
    await saveForMe(fields);
    return this.saveForTeam(folder, cleared, quiet);
  }

  private async saveForTeam(folder: vscode.Uri, fields: Fields, quiet: boolean): Promise<boolean> {
    const decision = await this.repoCheck.proposeChange(
      vscode.Uri.joinPath(folder, REPO_CONFIG_FILE),
      current => setAttachments(current, fields as Partial<AttachmentsConfig>),
      vscode.l10n.t('Images and attachments in {0}, for the whole team', REPO_CONFIG_FILE),
      quiet ? () => 'apply' : undefined,
    );
    return decision === 'apply' || decision === 'unchanged';
  }
}
