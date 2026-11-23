import * as vscode from 'vscode';
import {
  centralExampleUrl,
  centralLabel,
  GitHubError,
  centralTemplates,
  CentralTemplatesSource,
  DocTemplate,
  loadCentralTemplates,
  parseRepoConfig,
  parseTemplatesRepository,
  REPO_CONFIG_FILE,
  SiteTemplate,
} from '@edtroleis/techdocs-editor-core';
import { readText } from './templateSources';
import { anonymousClientFor, clientFor, gitHubErrorText } from '../publish/githubAuth';

/** A cópia guardada passa a ser conferida no GitHub depois de uma hora (e pelo comando "Atualizar"). */
export const CENTRAL_REFRESH_MS = 60 * 60 * 1000;

/** Templates centrais prontos para a lista: a origem e o que a pasta tem. */
export type CentralTemplatesState = {
  label: string;
  source: CentralTemplatesSource;
  /** A pasta de idioma usada, se o repositório tem pastas de idioma (spec 08). */
  language?: string;
  pages: DocTemplate[];
  sites: { template: SiteTemplate; files: Record<string, string> }[];
};

type Cache = { key: string; sha: string; checkedAt: number; files: Record<string, string> };

/**
 * Templates centrais da empresa (spec 04, TA3), de `techdocsEditor.templates.repository`. Ficam guardados no
 * armazenamento da extensão pelo commit: sem rede (ou sem acesso), vale a última cópia.
 */
export class CentralTemplates {
  private memory: Cache | undefined;
  /** Avisos já mostrados nesta sessão (um por origem), para não repetir a cada lista. */
  private readonly warned = new Set<string>();

  constructor(private readonly context: Pick<vscode.ExtensionContext, 'globalStorageUri' | 'globalState'>) {}

  /** A origem configurada (ver templatesOrigin). */
  async source(scope?: vscode.Uri): Promise<CentralTemplatesSource | undefined> {
    return parseTemplatesRepository((await templatesOrigin(scope)).value);
  }

  /**
   * Os templates centrais: a cópia guardada, conferida no GitHub se tem mais de uma hora (ou com `force`). Com as
   * pastas de idioma do repositório de templates (spec 08), os da `language` (a do site).
   */
  async get(scope?: vscode.Uri, force = false, language = 'en'): Promise<CentralTemplatesState | undefined> {
    const source = await this.source(scope);
    if (!source) return undefined;
    const state = (label: string, files: Record<string, string>): CentralTemplatesState => ({ label, source, ...centralTemplates(files, language) });
    const label = centralLabel(source);
    const key = `${source.host}/${source.slug}/${source.folder}@${source.ref ?? ''}`;
    const cache = this.memory?.key === key ? this.memory : await this.readCache(key);
    if (cache && !force && Date.now() - cache.checkedAt < CENTRAL_REFRESH_MS) return state(label, cache.files);
    const needsAuthKey = `centralTemplates.needsAuth:${source.host}/${source.slug}`;
    try {
      const { result, needsAuth } = await loadCentralTemplates({
        source,
        cachedSha: cache?.sha,
        needsAuth: this.context.globalState.get<boolean>(needsAuthKey, false),
        client: withLogin => (withLogin ? clientFor(source.host, source.slug) : anonymousClientFor(source.host, source.slug)),
      });
      await this.context.globalState.update(needsAuthKey, needsAuth);
      const fresh: Cache =
        result === 'unchanged' ? { ...cache!, checkedAt: Date.now() } : { key, sha: result.sha, checkedAt: Date.now(), files: result.files };
      await this.writeCache(fresh);
      this.warned.delete(key);
      return state(label, fresh.files);
    } catch (error) {
      const reason =
        error instanceof GitHubError && (error.status === 403 || error.status === 404)
          ? vscode.l10n.t('not found, or your GitHub account has no access to it')
          : gitHubErrorText(error, vscode.l10n);
      if (!this.warned.has(key)) {
        this.warned.add(key);
        void vscode.window.showWarningMessage(
          cache
            ? vscode.l10n.t(
                'Could not update the company templates from {0} ({1}). Using the copy from {2}.',
                label,
                reason,
                new Date(cache.checkedAt).toLocaleString(vscode.env.language),
              )
            : vscode.l10n.t('Could not read the company templates from {0}: {1}', label, reason),
        );
      }
      return cache && state(label, cache.files);
    }
  }

  private cacheUri(key: string) {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'central-templates', `${key.replace(/[^\w.-]+/g, '_')}.json`);
  }

  private async readCache(key: string): Promise<Cache | undefined> {
    try {
      const cache = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(this.cacheUri(key)))) as Cache;
      if (cache.key !== key) return undefined;
      this.memory = cache;
      return cache;
    } catch {
      return undefined;
    }
  }

  private async writeCache(cache: Cache) {
    this.memory = cache;
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.context.globalStorageUri, 'central-templates'));
      await vscode.workspace.fs.writeFile(this.cacheUri(cache.key), new TextEncoder().encode(JSON.stringify(cache)));
    } catch {
      // Sem onde guardar: a cópia fica só na memória até fechar o VS Code
    }
  }
}


/** Os templates de página da empresa como itens da lista, com o endereço do exemplo de cada um no GitHub. */
export const centralPageChoices = (company: CentralTemplatesState | undefined) =>
  (company?.pages ?? []).map(template => ({
    template,
    origin: 'central' as const,
    source: company!.label,
    ...(template.example && { exampleUrl: centralExampleUrl(company!.source, company!.language, template.example) }),
  }));

/** De onde vem o repositório de templates em uso (spec 08, TR5 e TR6). */
export type TemplatesOrigin = {
  value?: string;
  /** `repository`: o `.techdocs-editor.yaml` da documentação; `settings`: a configuração do VS Code; `default`: nenhum. */
  from: 'repository' | 'settings' | 'default';
  /** A pasta do repositório da documentação (onde fica ou ficaria o `.techdocs-editor.yaml`). */
  folder?: vscode.Uri;
};

/**
 * O repositório de templates para `scope`: o `templates.repository` do `.techdocs-editor.yaml` na raiz do repositório
 * da documentação (o padrão do time) vence a configuração do VS Code. Sem confiar no workspace, nem o arquivo nem a
 * configuração da pasta valem, só a do usuário: senão a extensão chamaria a rede por conta de um repositório que a
 * pessoa nem confirmou.
 */
export async function templatesOrigin(scope?: vscode.Uri): Promise<TemplatesOrigin> {
  const trusted = vscode.workspace.isTrusted;
  const folder = (scope && vscode.workspace.getWorkspaceFolder(scope)?.uri) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (trusted && folder) {
    const text = await readText(vscode.Uri.joinPath(folder, REPO_CONFIG_FILE));
    const value = text === undefined ? undefined : parseRepoConfig(text).templates?.repository;
    if (value) return { value, from: 'repository', folder };
  }
  const inspect = vscode.workspace.getConfiguration('techdocsEditor.templates', scope).inspect<string>('repository');
  const value = (trusted ? (inspect?.workspaceFolderValue ?? inspect?.workspaceValue ?? inspect?.globalValue) : inspect?.globalValue)?.trim();
  return value ? { value, from: 'settings', folder } : { from: 'default', folder };
}
