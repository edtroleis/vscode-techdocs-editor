import { type CatalogMode, cleanDir, cleanMaxMB, parseTemplatesRepository, parseTypes } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import { type AttachmentKey, type AttachmentOptions, type AttachmentOrigin, attachmentSettings } from './attachments';
import { type CatalogOptions, catalogModeFor, repositoryFolder } from './catalogOptions';
import { SEND_CSS } from './send/sendCss';
import { SETTINGS_CSS } from './settingsCss';
import { webviewHtml } from './send/sendPanel';
import { openSettings } from './settingsMenu';
import { templatesOrigin } from './templates/centralTemplates';
import type { TemplateOptions } from './templates/templateOptions';
import { builtInEnabled } from './templates/templateSources';

/**
 * Configurações do TechDocs (0.21): uma janela na seção TechDocs, no lugar das listas no topo da tela. Cada escolha
 * grava na hora. Os templates e o catalog-info.yaml valem para o time (no `.techdocs-editor.yaml` do repositório, com
 * o diff antes) ou só para a pessoa; o resto vale só para a pessoa. O webview só desenha.
 */

type Scope = 'team' | 'me';

export type SettingsState = {
  sendTarget: 'pullRequest' | 'main';
  cloneDirectory: string;
  /** Sem repositório aberto: undefined (as opções do repositório não aparecem). */
  templates?: { repository: string; scope: Scope; teamPossible: boolean; builtIn: boolean; test?: { ok: boolean; text: string } };
  catalog?: { mode: CatalogMode; scope: Scope; teamPossible: boolean };
  /** Imagens e anexos (spec 07): os campos como texto, de onde cada um vem, e o aviso do último campo recusado. */
  attachments?: {
    values: Record<AttachmentKey, string>;
    from: Record<AttachmentKey, AttachmentOrigin>;
    scope: Scope;
    teamPossible: boolean;
    error?: { key: AttachmentKey; text: string };
  };
  openVisual: boolean;
  syncExplorer: boolean;
};

export type SettingsMessage =
  | { type: 'ready' }
  | { type: 'sendTarget'; value: 'pullRequest' | 'main' }
  | { type: 'cloneDirectory' }
  | { type: 'templatesRepository'; value: string }
  | { type: 'templatesTest' }
  | { type: 'templatesBuiltIn'; value: boolean }
  | { type: 'templatesScope'; value: Scope }
  | { type: 'catalogMode'; value: CatalogMode }
  | { type: 'catalogScope'; value: Scope }
  | { type: 'attachment'; key: AttachmentKey; value: string }
  | { type: 'attachmentsScope'; value: Scope }
  | { type: 'attachmentsReset' }
  | { type: 'flag'; key: 'openVisualByDefault' | 'syncExplorer'; value: boolean }
  | { type: 'openAll' };

/** Os textos da janela, em inglês no código. */
export function settingsLabels() {
  return {
    send: vscode.l10n.t('Send'),
    forReview: vscode.l10n.t('For review'),
    forReviewHint: vscode.l10n.t('Someone on the team approves on GitHub before it goes into the documentation.'),
    straight: vscode.l10n.t('Straight to the documentation'),
    straightHint: vscode.l10n.t('Goes into the main branch right away, without review. Only for repositories that allow it.'),
    copies: vscode.l10n.t('GitHub copies'),
    copiesHint: vscode.l10n.t('Where "Open documentation from GitHub" brings the repositories.'),
    change: vscode.l10n.t('Change…'),
    templates: vscode.l10n.t('Templates'),
    templatesRepository: vscode.l10n.t('Templates repository'),
    templatesHint: vscode.l10n.t('owner/repo[/folder][@ref]; empty: only the extension templates'),
    testAccess: vscode.l10n.t('Test access'),
    builtIn: vscode.l10n.t('Show the extension templates too'),
    catalogAuto: vscode.l10n.t('Check only if it exists'),
    catalogAutoHint: vscode.l10n.t('Without the file, only a hint. With it, the TechDocs annotation is checked.'),
    catalogRequired: vscode.l10n.t('Require it'),
    catalogRequiredHint: vscode.l10n.t('A missing file is a problem, with a fix that creates it.'),
    catalogOff: vscode.l10n.t('Do not use it'),
    catalogOffHint: vscode.l10n.t('Backstage registers the documentation some other way.'),
    forTeam: vscode.l10n.t('For the team'),
    forTeamHint: vscode.l10n.t('In .techdocs-editor.yaml of the repository, with the diff first'),
    justMe: vscode.l10n.t('Just for me'),
    justMeHint: vscode.l10n.t('In your VS Code settings'),
    attachments: vscode.l10n.t('Images and attachments'),
    images: vscode.l10n.t('Images'),
    otherFiles: vscode.l10n.t('Other attachments'),
    directory: vscode.l10n.t('Directory'),
    maxSize: vscode.l10n.t('Maximum size'),
    types: vscode.l10n.t('Types'),
    fromTeam: vscode.l10n.t('team'),
    fromMe: vscode.l10n.t('yours'),
    attachmentsHint: vscode.l10n.t('Directories inside docs/. Types: extensions separated by commas, add or remove the ones you want (saved when leaving the field or with Enter); * accepts any. Executables, scripts and .md never go in, even if written here.'),
    backToDefault: vscode.l10n.t('Back to default'),
    editor: vscode.l10n.t('Editor'),
    openVisual: vscode.l10n.t('Open the pages in the visual editor'),
    openVisualHint: vscode.l10n.t('Clicking a .md of the docs opens the visual editor, not the text.'),
    syncExplorer: vscode.l10n.t('Move and rename in the Explorer fixes the menu and the links'),
    allSettings: vscode.l10n.t('All settings in VS Code'),
  };
}
export type SettingsLabels = ReturnType<typeof settingsLabels>;

const config = () => vscode.workspace.getConfiguration('techdocsEditor');


export class SettingsView implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'techdocsEditor.settingsView';
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** O resultado do último Testar acesso (some ao trocar o repositório). */
  private lastTest: { ok: boolean; text: string } | undefined;
  /** Para o time / Só para mim enquanto nada foi gravado (o valor padrão não diz onde está). */
  private readonly chosen: { templates?: Scope; catalog?: Scope; attachments?: Scope } = {};
  /** O aviso do último campo de Imagens e anexos que não gravou (ou gravou sem os tipos recusados). */
  private attachmentError: { key: AttachmentKey; text: string } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: {
      templateOptions: TemplateOptions;
      catalogOptions: CatalogOptions;
      attachmentOptions: AttachmentOptions;
      /** O `mkdocs.yml` do site mostrado na árvore: as opções do repositório valem para o repositório dele. */
      site: () => vscode.Uri | undefined;
    },
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/.techdocs-editor.yaml');
    this.disposables.push(
      watcher,
      watcher.onDidChange(() => this.post()),
      watcher.onDidCreate(() => this.post()),
      watcher.onDidDelete(() => this.post()),
      vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('techdocsEditor') && this.post()),
    );
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  /** "…" › Configurações…: mostra a janela na seção TechDocs. */
  async open() {
    await vscode.commands.executeCommand('setContext', 'techdocsEditor.settingsOpen', true);
    await vscode.commands.executeCommand(`${SettingsView.viewId}.focus`);
  }

  close() {
    return vscode.commands.executeCommand('setContext', 'techdocsEditor.settingsOpen', false);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')] };
    view.webview.html = webviewHtml(view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'settingsView.js')), SEND_CSS + SETTINGS_CSS);
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: SettingsMessage) => this.receive(message)),
      view.onDidChangeVisibility(() => view.visible && this.post()),
      view.onDidDispose(() => (this.view = undefined)),
    );
  }

  /** Onde valem as opções do repositório: o site mostrado, senão a primeira pasta do workspace. */
  private scope() {
    const uri = this.deps.site() ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    return { uri, folder: repositoryFolder(uri) };
  }

  async state(): Promise<SettingsState> {
    const { uri, folder } = this.scope();
    const trusted = vscode.workspace.isTrusted;
    let templates: SettingsState['templates'];
    let catalog: SettingsState['catalog'];
    if (folder) {
      const origin = await templatesOrigin(uri);
      templates = {
        repository: origin.value ?? '',
        scope: origin.from === 'repository' ? 'team' : origin.from === 'settings' ? 'me' : (this.chosen.templates ?? 'me'),
        teamPossible: Boolean(origin.folder) && trusted,
        builtIn: builtInEnabled(uri ?? folder),
        test: this.lastTest,
      };
      const current = await catalogModeFor(folder);
      catalog = {
        mode: current.mode,
        scope: current.source === 'repository' ? 'team' : current.source === 'settings' ? 'me' : (this.chosen.catalog ?? 'me'),
        teamPossible: trusted,
      };
    }
    const current = await attachmentSettings(uri);
    const origins = Object.values(current.from);
    const attachments: SettingsState['attachments'] = {
      values: Object.fromEntries(
        Object.entries(current.values).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]),
      ) as Record<AttachmentKey, string>,
      from: current.from,
      scope: origins.includes('repository') ? 'team' : origins.includes('settings') ? 'me' : (this.chosen.attachments ?? 'me'),
      teamPossible: Boolean(current.folder) && trusted,
      error: this.attachmentError,
    };
    return {
      sendTarget: config().get<string>('send.target') === 'main' ? 'main' : 'pullRequest',
      cloneDirectory: config().get<string>('clone.directory') || '~/Documents/TechDocs',
      templates,
      catalog,
      attachments,
      openVisual: config().get<boolean>('openVisualByDefault') ?? false,
      syncExplorer: config().get<boolean>('syncExplorer') ?? true,
    };
  }

  private async post() {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'state', state: await this.state(), labels: settingsLabels() });
  }

  /** O que a janela pede. `quiet`: testes de integração, grava para o time sem o diff. */
  async receive(message: SettingsMessage, quiet = false): Promise<void> {
    const { uri, folder } = this.scope();
    const state = message.type === 'ready' || message.type === 'openAll' ? undefined : await this.state();
    if (message.type.startsWith('attachment')) this.attachmentError = undefined;
    switch (message.type) {
      case 'ready':
        break;
      case 'openAll':
        await openSettings();
        return;
      case 'sendTarget':
        await config().update('send.target', message.value, vscode.ConfigurationTarget.Global);
        break;
      case 'cloneDirectory': {
        const [picked] =
          (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: vscode.l10n.t('Use this directory') })) ?? [];
        if (picked) await config().update('clone.directory', picked.fsPath, vscode.ConfigurationTarget.Global);
        break;
      }
      case 'templatesRepository': {
        const value = message.value.trim();
        if (value && !parseTemplatesRepository(value)) {
          void vscode.window.showErrorMessage(vscode.l10n.t('Use owner/repo, optionally with /folder and @ref'));
          break;
        }
        if (value === state?.templates?.repository) return;
        this.lastTest = undefined;
        await this.deps.templateOptions.setRepository(uri, value || undefined, state?.templates?.scope ?? 'me', quiet);
        break;
      }
      case 'templatesTest':
        this.lastTest = await this.deps.templateOptions.testAccess(uri);
        break;
      case 'templatesBuiltIn':
        await vscode.workspace.getConfiguration('techdocsEditor.templates').update('builtIn', message.value, vscode.ConfigurationTarget.Global);
        break;
      case 'templatesScope':
        this.chosen.templates = message.value;
        await this.deps.templateOptions.moveRepository(uri, message.value, quiet);
        break;
      case 'catalogMode':
        if (folder) await this.deps.catalogOptions.save(folder, message.value, state?.catalog?.scope ?? 'me', quiet);
        break;
      case 'catalogScope':
        this.chosen.catalog = message.value;
        if (folder && state?.catalog?.scope !== message.value) await this.deps.catalogOptions.move(folder, message.value, quiet);
        break;
      case 'attachment': {
        const parsed = this.parseAttachment(message.key, message.value);
        if (parsed === null) break;
        await this.deps.attachmentOptions.save(uri, state?.attachments?.scope ?? 'me', { [message.key]: parsed }, quiet);
        break;
      }
      case 'attachmentsScope':
        this.chosen.attachments = message.value;
        await this.deps.attachmentOptions.move(uri, message.value, quiet);
        break;
      case 'attachmentsReset': {
        const all = Object.fromEntries(Object.keys(state?.attachments?.from ?? {}).map(key => [key, undefined]));
        // Do time e da pessoa: o padrão de novo nos dois lugares
        if (state?.attachments?.teamPossible) await this.deps.attachmentOptions.save(uri, 'team', all, quiet);
        await this.deps.attachmentOptions.save(uri, 'me', all, quiet);
        break;
      }
      case 'flag':
        await config().update(message.key, message.value, vscode.ConfigurationTarget.Global);
        break;
    }
    // Também quando a pessoa desistiu (no diff, na escolha do diretório): a janela volta a mostrar o que vale
    await this.post();
  }

  /** O campo como vai para o arquivo: undefined volta ao padrão; null não grava (o aviso fica embaixo do campo). */
  private parseAttachment(key: AttachmentKey, text: string): unknown {
    const value = text.trim();
    if (!value) return undefined;
    if (key === 'images' || key === 'files') {
      const dir = cleanDir(value);
      if (dir === undefined) this.attachmentError = { key, text: vscode.l10n.t('Use a directory inside docs/, without "..".') };
      return dir ?? null;
    }
    if (key === 'imagesMaxSizeMB' || key === 'filesMaxSizeMB') {
      const size = cleanMaxMB(Number(value.replace(',', '.')));
      if (size === undefined) this.attachmentError = { key, text: vscode.l10n.t('Use a number of MB greater than zero.') };
      return size ?? null;
    }
    const { types, refused } = parseTypes(value);
    if (refused.length) {
      this.attachmentError = {
        key,
        text: vscode.l10n.t('{0}: not accepted. Executables, scripts and .md never go in (the rest was saved).', refused.join(', ')),
      };
    }
    return types;
  }
}
