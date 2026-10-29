import * as vscode from 'vscode';
import { chooseSites, dismissChooseSites, hideSite, useTestSiteChoice } from './chooseSites';
import { REMOTE_SCHEME } from '@edtroleis/techdocs-editor-core';
import { CatalogOptions, repositoryFolder } from './catalogOptions';
import { CheckItem, CheckView } from './checkView';
import { DocsItem, DocsTreeView } from './docsTreeView';
import { LintActions } from './lintActions';
import { LintService } from './lintService';
import { LocalSites } from './localSites';
import { openVisualByDefault } from './openByDefault';
import { ProposedChanges } from './proposedChange';
import { PrepareContext } from './prepareContext';
import { PublishPanel } from './publish/publishPanel';
import { RemoteOpener } from './remote/openRemote';
import { ConflictPanel, resolveSaveConflicts } from './remote/conflictPanel';
import { RemoteFileSystem } from './remote/remoteFs';
import { RemoteRepos } from './remote/remoteRepos';
import { RepoCheck } from './repoCheck';
import { CentralTemplates } from './templates/centralTemplates';
import { NewPageCommand } from './templates/newPage';
import { NewSiteCommand } from './templates/newSite';
import { SitePreview } from './templates/sitePreview';
import { VisualEditorProvider } from './visualEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const sites = new LocalSites();
  const remotes = new RemoteRepos(context.globalState);
  const remoteFs = new RemoteFileSystem(remotes);
  const opener = new RemoteOpener(remotes);
  const lint = new LintService(sites);
  const provider = new VisualEditorProvider(context.extensionUri, lint, sites, remoteFs);
  const docs = new DocsTreeView(sites, remotes);
  const conflicts = new ConflictPanel(context.extensionUri);
  const publish = new PublishPanel(context.extensionUri, sites, lint, remotes, remoteFs, conflicts);
  const central = new CentralTemplates(context);
  const newPage = new NewPageCommand(sites, provider, central);
  const proposals = new ProposedChanges();
  const newSite = new NewSiteCommand(central, proposals);
  const repoCheck = new RepoCheck(sites, lint, newSite, proposals);
  const checkView = new CheckView(repoCheck);
  const catalogOptions = new CatalogOptions(repoCheck);
  newSite.useCatalogOptions(catalogOptions);
  const preview = new SitePreview(context.extensionUri, newSite);
  newSite.usePreview(preview);
  const prepare = new PrepareContext(sites);
  context.subscriptions.push(
    remotes,
    vscode.workspace.registerFileSystemProvider(REMOTE_SCHEME, remoteFs, { isCaseSensitive: true }),
    resolveSaveConflicts(remoteFs, conflicts),
    vscode.window.registerUriHandler({
      handleUri: async uri => {
        await opener.fromLink(uri);
      },
    }),
    vscode.commands.registerCommand('techdocsEditor.openRemote', (input?: string) => opener.fromInput(typeof input === 'string' ? input : undefined)),
    vscode.commands.registerCommand('techdocsEditor.chooseSites', () => chooseSites(sites)),
    vscode.commands.registerCommand('techdocsEditor.hideSite', (item?: DocsItem) => hideSite(sites, item?.siteRoot)),
    vscode.commands.registerCommand('techdocsEditor.dismissChooseSites', () => dismissChooseSites()),
    vscode.commands.registerCommand('techdocsEditor.closeRemote', (item?: DocsItem) => item?.remote && remotes.remove(item.remote)),
    vscode.commands.registerCommand('techdocsEditor.refreshRemote', (item?: DocsItem) =>
      item?.remote ? remotes.refresh(item.remote.host, item.remote.slug) : remotes.refresh(),
    ),
    proposals,
    publish,
    repoCheck,
    checkView,
    prepare,
    docsPageContext(sites),
    vscode.window.registerWebviewViewProvider(PublishPanel.viewId, publish),
    preview,
    vscode.window.registerWebviewViewProvider(SitePreview.viewId, preview),
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
    // A engrenagem da seção Verificação e o "Configurar…" do item sem catalog-info.yaml
    vscode.commands.registerCommand('techdocsEditor.checkOptions', (item?: CheckItem) =>
      catalogOptions.choose(repositoryFolder(item instanceof CheckItem ? item.base : undefined)),
    ),
    vscode.commands.registerCommand('techdocsEditor.prepareDocs', (target?: vscode.Uri) =>
      repoCheck.prepare(target instanceof vscode.Uri ? target : undefined),
    ),
    vscode.commands.registerCommand('techdocsEditor.openText', (uri?: vscode.Uri) => {
      const target = uri ?? activeCustomEditorUri();
      if (target) return vscode.commands.executeCommand('vscode.openWith', target, 'default', vscode.ViewColumn.Beside);
    }),
  );
  // Usado pelos testes de integração (test/vscode)
  return { provider, sites, lint, docs, publish, newPage, newSite, repoCheck, checkView, central, catalogOptions, prepare, preview, remotes, remoteFs, opener, conflicts, useTestSiteChoice };
}

/**
 * `techdocsEditor.activeIsDocs`: o editor ativo é uma página de um `docs_dir` ou do GitHub. Os botões e comandos do editor
 * visual aparecem só nessas páginas, e não em qualquer Markdown (um README, por exemplo).
 */
function docsPageContext(sites: LocalSites): vscode.Disposable {
  const update = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
    // Páginas do GitHub (`techdocs:`) também são de docs
    const isDocs = Boolean(uri && (uri.scheme === REMOTE_SCHEME ? /\.md$/i.test(uri.path) : sites.siteOf(uri)));
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.activeIsDocs', isDocs);
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
