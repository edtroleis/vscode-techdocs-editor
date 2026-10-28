import * as vscode from 'vscode';
import { CheckView } from './checkView';
import { DocsItem, DocsTreeView } from './docsTreeView';
import { LintActions } from './lintActions';
import { LintService } from './lintService';
import { LocalSites } from './localSites';
import { openVisualByDefault } from './openByDefault';
import { PublishPanel } from './publish/publishPanel';
import { RepoCheck } from './repoCheck';
import { CentralTemplates } from './templates/centralTemplates';
import { NewPageCommand } from './templates/newPage';
import { NewSiteCommand } from './templates/newSite';
import { VisualEditorProvider } from './visualEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const sites = new LocalSites();
  const lint = new LintService(sites);
  const provider = new VisualEditorProvider(context.extensionUri, lint, sites);
  const docs = new DocsTreeView(sites);
  const publish = new PublishPanel(context.extensionUri, sites, lint);
  const central = new CentralTemplates(context);
  const newPage = new NewPageCommand(sites, provider, central);
  const newSite = new NewSiteCommand(central);
  const repoCheck = new RepoCheck(sites, lint, newSite);
  const checkView = new CheckView(repoCheck);
  context.subscriptions.push(
    publish,
    repoCheck,
    checkView,
    docsPageContext(sites),
    vscode.window.registerWebviewViewProvider(PublishPanel.viewId, publish),
    sites,
    lint,
    docs,
    vscode.languages.registerCodeActionsProvider({ language: 'markdown' }, new LintActions(lint), {
      providedCodeActionKinds: LintActions.kinds,
    }),
    openVisualByDefault(sites),
    vscode.window.registerCustomEditorProvider(VisualEditorProvider.viewType, provider, {
      // Trocar de aba recriaria o editor e perderia cursor e rolagem
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand('techdocsEditor.openVisual', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, VisualEditorProvider.viewType);
    }),
    vscode.commands.registerCommand('techdocsEditor.newPage', (target?: vscode.Uri | DocsItem) =>
      newPage.run(target instanceof vscode.Uri || target instanceof DocsItem ? target : undefined),
    ),
    vscode.commands.registerCommand('techdocsEditor.newSite', (target?: vscode.Uri) =>
      newSite.run(target instanceof vscode.Uri ? target : undefined),
    ),
    vscode.commands.registerCommand('techdocsEditor.refreshTemplates', () => refreshCentralTemplates(central)),
    vscode.commands.registerCommand('techdocsEditor.checkDocs', () => repoCheck.check()),
    vscode.commands.registerCommand('techdocsEditor.prepareDocs', (target?: vscode.Uri) =>
      repoCheck.prepare(target instanceof vscode.Uri ? target : undefined),
    ),
    vscode.commands.registerCommand('techdocsEditor.openText', (uri?: vscode.Uri) => {
      const target = uri ?? activeCustomEditorUri();
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, 'default', vscode.ViewColumn.Beside);
    }),
  );
  // Usado pelos testes de integração (test/vscode)
  return { provider, sites, lint, docs, publish, newPage, newSite, repoCheck, checkView, central };
}

/**
 * `techdocsEditor.activeIsDocs`: o editor ativo é uma página de um `docs_dir`. Os botões e comandos do editor
 * visual aparecem só nessas páginas, e não em qualquer Markdown (um README, por exemplo).
 */
function docsPageContext(sites: LocalSites): vscode.Disposable {
  const update = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.activeIsDocs', Boolean(uri && sites.siteOf(uri)));
  };
  update();
  return vscode.Disposable.from(
    // O editor de texto ativo muda antes do evento das abas: os dois atualizam
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.window.tabGroups.onDidChangeTabs(update),
    vscode.window.tabGroups.onDidChangeTabGroups(update),
    sites.onDidChange(update),
  );
}

/** "Atualizar os templates da empresa" (TA3): confere no GitHub agora, sem esperar a hora. */
async function refreshCentralTemplates(central: CentralTemplates) {
  if (!central.source()) {
    const open = vscode.l10n.t('Open settings');
    const answer = await vscode.window.showInformationMessage(
      vscode.l10n.t('No company templates are set. Point techdocsEditor.templates.repository to the repository with them.'),
      open,
    );
    if (answer === open) await vscode.commands.executeCommand('workbench.action.openSettings', 'techdocsEditor.templates.repository');
    return;
  }
  const result = await central.get(undefined, true);
  if (result) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Company templates from {0}: {1} page templates and {2} site templates.', result.label, result.pages.length, result.sites.length),
    );
  }
}

function activeCustomEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

export function deactivate() {}
