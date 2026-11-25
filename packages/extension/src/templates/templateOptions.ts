import * as vscode from 'vscode';
import { parseTemplatesRepository, REPO_CONFIG_FILE, setTemplatesRepository } from '@edtroleis/techdocs-editor-core';
import { templateLanguage } from '@edtroleis/techdocs-editor-core/src/builtInTemplates';
import type { RepoCheck } from '../repoCheck';
import { type CentralTemplates, templatesOrigin, type TemplatesOrigin } from './centralTemplates';
import { builtInEnabled } from './templateSources';

/** O que fazer na "Opções dos templates". */
export type TemplateOptionsAction = 'change' | 'test' | 'builtIn' | 'reset';

/** Respostas prontas para os testes: a ação, o repositório (em `change`) e onde gravar. */
export type TemplateOptionsAnswers = { action: TemplateOptionsAction; repository?: string; scope?: 'team' | 'me' };

const config = (scope?: vscode.Uri) => vscode.workspace.getConfiguration('techdocsEditor.templates', scope);

/**
 * "Opções dos templates" (spec 08, TR5): mostra o repositório de templates em uso e de onde ele vem (o
 * `.techdocs-editor.yaml` da documentação, as configurações ou nenhum), e deixa trocar, testar o acesso, ligar ou
 * desligar os templates da extensão e voltar ao padrão. Trocar e voltar ao padrão gravam para o time (no
 * `.techdocs-editor.yaml`, com o diff antes) ou só para quem escolheu (configurações do usuário).
 */
export class TemplateOptions {
  constructor(
    private readonly central: CentralTemplates,
    private readonly repoCheck: Pick<RepoCheck, 'proposeChange'>,
  ) {}

  /** Devolve a ação feita (undefined: cancelou ou não deu). */
  async choose(scope = vscode.workspace.workspaceFolders?.[0]?.uri, answers?: TemplateOptionsAnswers): Promise<TemplateOptionsAction | undefined> {
    const origin = await templatesOrigin(scope);
    const action = answers?.action ?? (await this.pickAction(origin, scope));
    if (!action) return undefined;
    if (action === 'test') return (await this.test(scope, Boolean(answers))) ? action : undefined;
    if (action === 'builtIn') {
      await config(scope).update('builtIn', !builtInEnabled(scope ?? vscode.Uri.file('/')), vscode.ConfigurationTarget.Global);
      if (!answers) warnWorkspaceOverride(scope, 'builtIn');
      return action;
    }
    const repository = action === 'change' ? (answers?.repository ?? (await askRepository(origin.value))) : undefined;
    if (action === 'change' && !repository) return undefined;
    // Voltar ao padrão "para o time" só tira o que está no .techdocs-editor.yaml: sem nada lá, é nas configurações
    const teamPossible = origin.folder && vscode.workspace.isTrusted && (action !== 'reset' || origin.from === 'repository');
    const where = answers?.scope ?? (teamPossible ? await pickScope(action) : 'me');
    if (!where) return undefined;
    const saved = where === 'team' && origin.folder ? await this.saveForTeam(origin.folder, repository, Boolean(answers)) : await saveForMe(repository);
    if (saved && where === 'me' && origin.from === 'repository' && !answers) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Saved in your settings. In this repository, the one in {0} still wins: it is the team default.', REPO_CONFIG_FILE),
      );
    } else if (saved && where === 'me' && !answers) warnWorkspaceOverride(scope, 'repository');
    return saved ? action : undefined;
  }

  private async pickAction(origin: TemplatesOrigin, scope: vscode.Uri | undefined): Promise<TemplateOptionsAction | undefined> {
    const from =
      origin.from === 'repository'
        ? vscode.l10n.t('set in {0}, for the whole team', REPO_CONFIG_FILE)
        : origin.from === 'settings'
          ? vscode.l10n.t('set in your settings')
          : vscode.l10n.t('only the extension templates');
    const builtIn = builtInEnabled(scope ?? vscode.Uri.file('/'));
    type Item = vscode.QuickPickItem & { action?: TemplateOptionsAction };
    const items: Item[] = [
      { label: origin.value ? `$(organization) ${origin.value}` : `$(package) ${vscode.l10n.t('TechDocs Editor templates')}`, description: from, kind: vscode.QuickPickItemKind.Separator },
      { label: `$(edit) ${vscode.l10n.t('Use another templates repository…')}`, detail: vscode.l10n.t('A GitHub repository in the format of edtroleis/techdocs-templates: owner/repo[/folder][@ref]'), action: 'change' },
      ...(origin.value ? [{ label: `$(plug) ${vscode.l10n.t('Test access')}`, detail: vscode.l10n.t('Reads the repository now and says how many templates it has'), action: 'test' as const }] : []),
      {
        label: `${builtIn ? '$(pass-filled)' : '$(circle-large-outline)'} ${vscode.l10n.t('Show the extension templates')}`,
        detail: vscode.l10n.t('Next to the ones from the repository (techdocsEditor.templates.builtIn)'),
        action: 'builtIn',
      },
      ...(origin.value ? [{ label: `$(discard) ${vscode.l10n.t('Back to the default')}`, detail: vscode.l10n.t('Only the extension templates, with no repository'), action: 'reset' as const }] : []),
    ];
    const picked = await vscode.window.showQuickPick(items, { title: vscode.l10n.t('Template options') });
    return picked?.action;
  }

  /** Grava o repositório (undefined: volta ao padrão) para o time ou para a pessoa (janela Configurações). */
  async setRepository(scope: vscode.Uri | undefined, repository: string | undefined, where: 'team' | 'me', quiet = false): Promise<boolean> {
    const origin = await templatesOrigin(scope);
    if (where === 'team' && origin.folder && vscode.workspace.isTrusted) return this.saveForTeam(origin.folder, repository, quiet);
    return saveForMe(repository);
  }

  /**
   * Leva o repositório em uso para o time (o `.techdocs-editor.yaml`, com o diff antes) ou para a pessoa (e tira do
   * arquivo, com o diff antes: senão o do time continuaria valendo).
   */
  async moveRepository(scope: vscode.Uri | undefined, to: 'team' | 'me', quiet = false): Promise<boolean> {
    const origin = await templatesOrigin(scope);
    if (!origin.value) return true;
    if (to === 'team') {
      if (!origin.folder || !(await this.saveForTeam(origin.folder, origin.value, quiet))) return false;
      if (origin.from === 'settings') await saveForMe(undefined);
      return true;
    }
    await saveForMe(origin.value);
    return origin.from !== 'repository' || !origin.folder || this.saveForTeam(origin.folder, undefined, quiet);
  }

  /** Testar acesso, sem aviso: o resultado em texto para a janela Configurações. */
  async testAccess(scope: vscode.Uri | undefined): Promise<{ ok: boolean; text: string }> {
    const result = await this.central.get(scope, true, templateLanguage(vscode.env.language));
    return result
      ? { ok: true, text: vscode.l10n.t('{0} page templates and {1} site templates', result.pages.length, result.sites.length) }
      : { ok: false, text: vscode.l10n.t('Could not read the repository') };
  }

  /** Lê o repositório agora. Sem acesso, o próprio CentralTemplates avisa (uma vez por sessão: aqui, sempre). */
  private async test(scope: vscode.Uri | undefined, quiet: boolean): Promise<boolean> {
    const result = await this.central.get(scope, true, templateLanguage(vscode.env.language));
    if (result && !quiet) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Company templates from {0}: {1} page templates and {2} site templates.', result.label, result.pages.length, result.sites.length),
      );
    }
    return Boolean(result);
  }

  /** Grava `templates.repository` no `.techdocs-editor.yaml` (sem valor: tira), com o diff antes. */
  private async saveForTeam(folder: vscode.Uri, repository: string | undefined, quiet: boolean): Promise<boolean> {
    const decision = await this.repoCheck.proposeChange(
      vscode.Uri.joinPath(folder, REPO_CONFIG_FILE),
      current => setTemplatesRepository(current, repository),
      repository
        ? vscode.l10n.t('templates.repository: {0} in {1}, for the whole team', repository, REPO_CONFIG_FILE)
        : vscode.l10n.t('No templates repository in {0}', REPO_CONFIG_FILE),
      quiet ? () => 'apply' : undefined,
    );
    return decision === 'apply' || decision === 'unchanged';
  }
}

async function askRepository(current: string | undefined): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: vscode.l10n.t('Templates repository'),
    prompt: vscode.l10n.t('owner/repo[/folder][@ref], or host/owner/repo for GitHub Enterprise'),
    placeHolder: 'edtroleis/techdocs-templates/templates',
    value: current,
    ignoreFocusOut: true,
    validateInput: text => (parseTemplatesRepository(text) ? undefined : vscode.l10n.t('Use owner/repo, optionally with /folder and @ref')),
  });
  return value?.trim() || undefined;
}

async function pickScope(action: TemplateOptionsAction): Promise<'team' | 'me' | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('For the team'), description: vscode.l10n.t('in {0}, with the diff first', REPO_CONFIG_FILE), scope: 'team' as const },
      { label: vscode.l10n.t('Just for me'), description: vscode.l10n.t('in your VS Code settings'), scope: 'me' as const },
    ],
    { title: action === 'reset' ? vscode.l10n.t('Back to the default where?') : vscode.l10n.t('Where to save it?') },
  );
  return picked?.scope;
}

/**
 * As configurações da workspace (`.vscode/settings.json`) vencem as do usuário, onde "Só para mim" grava: avisa em
 * vez de mudar um arquivo do repositório.
 */
function warnWorkspaceOverride(scope: vscode.Uri | undefined, key: 'repository' | 'builtIn') {
  if (!vscode.workspace.isTrusted) return;
  const inspect = config(scope).inspect(key);
  const value = inspect?.workspaceFolderValue ?? inspect?.workspaceValue;
  if (value === undefined) return;
  void vscode.window.showWarningMessage(
    vscode.l10n.t('The workspace settings still set techdocsEditor.templates.{0} to {1}, and they win over your settings.', key, String(value)),
  );
}

async function saveForMe(repository: string | undefined): Promise<boolean> {
  await config().update('repository', repository, vscode.ConfigurationTarget.Global);
  return true;
}
