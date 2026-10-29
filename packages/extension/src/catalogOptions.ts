import * as vscode from 'vscode';
import { CatalogMode, parseRepoConfig, REPO_CONFIG_FILE, setCatalogMode } from '@edtroleis/techdocs-editor-core';
import type { RepoCheck } from './repoCheck';
import { readText } from './templates/templateSources';

/** De onde veio o modo: o `.techdocs-editor.yaml` do repositório, a configuração do VS Code ou o padrão. */
export type CatalogModeSource = 'repository' | 'settings' | 'default';

/** Onde gravar a escolha: no repositório, para o time, ou só na configuração de quem escolheu. */
export type CatalogModeScope = 'team' | 'me';

/** Respostas prontas para os testes de integração (sem as listas nem o diff). */
export type CatalogOptionsAnswers = { mode: CatalogMode; scope: CatalogModeScope };

/** Resposta pronta para `askUsage` nos testes. */
export type CatalogUsageAnswer = 'yes' | 'no' | 'unknown';

/** Pasta do repositório: a do workspace do arquivo, senão a primeira do workspace. */
export function repositoryFolder(uri?: vscode.Uri): vscode.Uri | undefined {
  return (uri && vscode.workspace.getWorkspaceFolder(uri)?.uri) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * O modo do `catalog-info.yaml` na conferência (spec 04): o `.techdocs-editor.yaml` do repositório vence a
 * configuração `techdocsEditor.catalog`. Num workspace não confiável, nem o arquivo nem a configuração da pasta
 * valem: só a do usuário.
 */
export async function catalogModeFor(folder: vscode.Uri | undefined): Promise<{ mode: CatalogMode; source: CatalogModeSource }> {
  const trusted = vscode.workspace.isTrusted;
  if (trusted && folder) {
    const text = await readText(vscode.Uri.joinPath(folder, REPO_CONFIG_FILE));
    const mode = text === undefined ? undefined : parseRepoConfig(text).catalog;
    if (mode) return { mode, source: 'repository' };
  }
  const inspect = vscode.workspace.getConfiguration('techdocsEditor', folder).inspect<CatalogMode>('catalog');
  const value = trusted ? (inspect?.workspaceFolderValue ?? inspect?.workspaceValue ?? inspect?.globalValue) : inspect?.globalValue;
  return value === 'auto' || value === 'required' || value === 'off' ? { mode: value, source: 'settings' } : { mode: 'auto', source: 'default' };
}

/**
 * "Opções da verificação" (a engrenagem da seção Verificação): o modo do `catalog-info.yaml`, gravado para o time
 * (no `.techdocs-editor.yaml`, com o diff antes) ou só para quem escolheu (configuração do VS Code).
 */
export class CatalogOptions {
  constructor(private readonly repoCheck: RepoCheck) {}

  /** A lista dos três modos e depois onde gravar. Devolve o modo gravado (undefined: cancelou). */
  async choose(folder = repositoryFolder(), answers?: CatalogOptionsAnswers): Promise<CatalogMode | undefined> {
    if (!folder) return undefined;
    const current = await catalogModeFor(folder);
    const mode = answers?.mode ?? (await this.pickMode(current.mode, current.source));
    if (!mode) return undefined;
    const scope = answers?.scope ?? (await pickScope());
    if (!scope) return undefined;
    const saved = scope === 'team' ? await this.saveForTeam(folder, mode, Boolean(answers)) : await saveForMe(mode);
    if (!saved) return undefined;
    await this.repoCheck.check(true);
    return mode;
  }

  /**
   * Pergunta uma vez se o Backstage usa o `catalog-info.yaml` do repositório (para o "Preparar"): sim grava
   * `catalog: required`, não grava `catalog: off` no `.techdocs-editor.yaml`; "não sei" não grava nada e fica o
   * `auto`. A resposta já é a decisão: grava sem diff. Devolve o modo (undefined: cancelou).
   */
  async askUsage(folder = repositoryFolder(), answer?: CatalogUsageAnswer): Promise<CatalogMode | undefined> {
    if (!folder) return undefined;
    type Item = vscode.QuickPickItem & { value: CatalogUsageAnswer };
    const picked =
      answer ??
      (
        await vscode.window.showQuickPick<Item>(
          [
            { label: vscode.l10n.t('Yes'), description: vscode.l10n.t('check the TechDocs annotation and offer to create the file'), value: 'yes' },
            { label: vscode.l10n.t('No'), description: vscode.l10n.t('Backstage registers the docs some other way: no more talk of catalog-info.yaml'), value: 'no' },
            { label: vscode.l10n.t('Not sure'), description: vscode.l10n.t('check catalog-info.yaml only if it exists'), value: 'unknown' },
          ],
          { title: vscode.l10n.t('Does your Backstage use a catalog-info.yaml in the repository?'), ignoreFocusOut: true },
        )
      )?.value;
    if (!picked) return undefined;
    if (picked === 'unknown') return 'auto';
    const mode: CatalogMode = picked === 'yes' ? 'required' : 'off';
    await this.saveForTeam(folder, mode, true);
    // A Verificação já conferiu nesta sessão: ela mostra o modo novo sem esperar o próximo salvamento
    if (this.repoCheck.last) await this.repoCheck.check(true);
    return mode;
  }

  private async pickMode(current: CatalogMode, source: CatalogModeSource): Promise<CatalogMode | undefined> {
    const from =
      source === 'repository'
        ? vscode.l10n.t('set in {0}', REPO_CONFIG_FILE)
        : source === 'settings'
          ? vscode.l10n.t('set in your settings')
          : vscode.l10n.t('default');
    const modes: { mode: CatalogMode; label: string; detail: string }[] = [
      { mode: 'auto', label: vscode.l10n.t('Check only if it exists'), detail: vscode.l10n.t('Without the file, only a hint. With it, the TechDocs annotation is checked.') },
      { mode: 'required', label: vscode.l10n.t('Require it'), detail: vscode.l10n.t('Backstage reads the catalog-info.yaml of the repository: a missing file is a problem, with a fix that creates it.') },
      { mode: 'off', label: vscode.l10n.t('Do not use it'), detail: vscode.l10n.t('Backstage registers the docs some other way: nothing about catalog-info.yaml.') },
    ];
    const picked = await vscode.window.showQuickPick(
      modes.map(m => ({
        label: `${m.mode === current ? '$(pass-filled)' : '$(circle-large-outline)'} ${m.label}`,
        description: m.mode === current ? from : undefined,
        detail: m.detail,
        mode: m.mode,
      })),
      { title: vscode.l10n.t('Check options: catalog-info.yaml') },
    );
    return picked?.mode;
  }

  /** Grava `catalog` no `.techdocs-editor.yaml`, com o diff antes (sem ele nas respostas prontas). */
  private async saveForTeam(folder: vscode.Uri, mode: CatalogMode, quiet: boolean): Promise<boolean> {
    const uri = vscode.Uri.joinPath(folder, REPO_CONFIG_FILE);
    const decision = await this.repoCheck.proposeChange(
      uri,
      current => setCatalogMode(current, mode),
      vscode.l10n.t('catalog: {0} in {1}, for the whole team', mode, REPO_CONFIG_FILE),
      quiet ? () => 'apply' : undefined,
    );
    return decision === 'apply' || decision === 'unchanged';
  }
}

async function pickScope(): Promise<CatalogModeScope | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('For the team'), description: vscode.l10n.t('in {0}, with the diff first', REPO_CONFIG_FILE), scope: 'team' as const },
      { label: vscode.l10n.t('Just for me'), description: vscode.l10n.t('in your VS Code settings'), scope: 'me' as const },
    ],
    { title: vscode.l10n.t('Where to save it?') },
  );
  return picked?.scope;
}

async function saveForMe(mode: CatalogMode): Promise<boolean> {
  await vscode.workspace.getConfiguration('techdocsEditor').update('catalog', mode, vscode.ConfigurationTarget.Global);
  return true;
}
