import * as vscode from 'vscode';
import {
  centralLabel,
  GitHubError,
  centralTemplates,
  CentralTemplatesSource,
  DocTemplate,
  loadCentralTemplates,
  parseTemplatesRepository,
  SiteTemplate,
} from '@edtroleis/techdocs-editor-core';
import { anonymousClientFor, clientFor, gitHubErrorText } from '../publish/githubAuth';

/** A cópia guardada passa a ser conferida no GitHub depois de uma hora (e pelo comando "Atualizar"). */
export const CENTRAL_REFRESH_MS = 60 * 60 * 1000;

/** Templates centrais prontos para a lista: a origem e o que a pasta tem. */
export type CentralTemplatesState = {
  label: string;
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

  /**
   * A origem configurada. Sem confiar no workspace, só vale a configuração do usuário: a da pasta faria a
   * extensão chamar a rede por conta de um repositório que a pessoa nem confirmou.
   */
  source(scope?: vscode.Uri): CentralTemplatesSource | undefined {
    const config = vscode.workspace.getConfiguration('techdocsEditor.templates', scope);
    const value = vscode.workspace.isTrusted ? config.get<string>('repository') : config.inspect<string>('repository')?.globalValue;
    return parseTemplatesRepository(value);
  }

  /** Os templates centrais: a cópia guardada, conferida no GitHub se tem mais de uma hora (ou com `force`). */
  async get(scope?: vscode.Uri, force = false): Promise<CentralTemplatesState | undefined> {
    const source = this.source(scope);
    if (!source) return undefined;
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

const state = (label: string, files: Record<string, string>): CentralTemplatesState => ({ label, ...centralTemplates(files) });
