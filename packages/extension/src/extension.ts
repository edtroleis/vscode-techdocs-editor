import * as vscode from 'vscode';
import { useE2eToken } from './publish/githubAuth';
import { chooseSites, hideSite, useTestSiteChoice } from './chooseSites';
import { REMOTE_SCHEME } from '@edtroleis/techdocs-editor-core';
import { CatalogOptions, repositoryFolder } from './catalogOptions';
import { CheckItem, CheckView } from './checkView';
import { DocsItem, DocsTreeView, useTestSitePick } from './docsTreeView';
import { LintActions } from './lintActions';
import { LintService } from './lintService';
import { LocalSites } from './localSites';
import { MineItem, MineView } from './mineView';
import { openVisualByDefault } from './openByDefault';
import { ProposedChanges } from './proposedChange';
import { PrepareContext } from './prepareContext';
import { PublishPanel } from './publish/publishPanel';
import { RemoteOpener } from './remote/openRemote';
import { ConflictPanel, resolveSaveConflicts } from './remote/conflictPanel';
import { showPageHistory, useTestHistoryPick } from './remote/pageHistory';
import { RemoteFileSystem } from './remote/remoteFs';
import { RemoteRepos } from './remote/remoteRepos';
import { RepoCheck } from './repoCheck';
import { CentralTemplates } from './templates/centralTemplates';
import { NewPageCommand } from './templates/newPage';
import { NewSiteCommand } from './templates/newSite';
import { SitePreview } from './templates/sitePreview';
import { TreeActions, useTestAnswers } from './treeActions';
import { VisualEditorProvider } from './visualEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  // Cenários de usuário (e2e/scenarios): login no GitHub por token, nunca na extensão publicada. No navegador não há
  // `process`: lido pelo globalThis
  if (context.extensionMode !== vscode.ExtensionMode.Production) {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    useE2eToken(env?.TECHDOCS_EDITOR_E2E_GITHUB_TOKEN);
  }
  const sites = new LocalSites();
  const remotes = new RemoteRepos(context.globalState);
  const remoteFs = new RemoteFileSystem(remotes);
  const opener = new RemoteOpener(remotes);
  const lint = new LintService(sites);
  const provider = new VisualEditorProvider(context.extensionUri, lint, sites, remoteFs);
  const treeActions = new TreeActions();
  const docs = new DocsTreeView(sites, remotes, context.workspaceState, treeActions, lint);
  treeActions.use(docs);
  provider.linkPages = uri => docs.linkTargets(uri);
  const conflicts = new ConflictPanel(context.extensionUri);
  const publish = new PublishPanel(context.extensionUri, sites, lint, remotes, remoteFs, conflicts);
  // A faixa de estado da página (rascunho, em revisão…) no editor visual, e os botões dela
  publish.onDidChangeStrip(({ uri, strip }) => provider.setStrip(uri, strip));
  provider.onStripAction(({ uri, action }) => publish.runStripAction(uri, action));
  const mine = new MineView(sites, remotes, opener);
  docs.useDrafts(() => mine.draftRefs());
  // "Minhas alterações" acompanha quando a página muda de estado (salvou, enviou, publicou)
  let lastState = '';
  publish.onDidChangeStrip(({ strip }) => {
    const state = strip ? `${strip.tone}:${strip.state}` : '';
    if (state !== lastState && strip?.tone !== undefined) mine.refreshLater();
    lastState = state;
  });
  const central = new CentralTemplates(context);
  const newPage = new NewPageCommand(sites, provider, central, remotes);
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
    vscode.commands.registerCommand('techdocsEditor.pageHistory', (uri?: vscode.Uri | DocsItem) =>
      showPageHistory(remotes, remoteFs, uri instanceof vscode.Uri ? uri : uri?.uri),
    ),
    vscode.commands.registerCommand('techdocsEditor.chooseSites', () => chooseSites(sites)),
    vscode.commands.registerCommand('techdocsEditor.hideSite', (item?: DocsItem) => hideSite(sites, item?.siteRoot)),
    vscode.commands.registerCommand('techdocsEditor.chooseSite', () => docs.chooseSite()),
    vscode.commands.registerCommand('techdocsEditor.closeRemote', (item?: DocsItem) => item?.remote && remotes.remove(item.remote)),
    vscode.commands.registerCommand('techdocsEditor.refreshRemote', (item?: DocsItem) =>
      item?.remote ? remotes.refresh(item.remote.host, item.remote.slug) : remotes.refresh(),
    ),
    proposals,
    publish,
    mine,
    vscode.commands.registerCommand('techdocsEditor.openMine', (item?: MineItem) => item && mine.open(item)),
    vscode.commands.registerCommand('techdocsEditor.openMinePr', (item?: MineItem) => item && mine.openPr(item)),
    vscode.commands.registerCommand('techdocsEditor.refreshMine', () => mine.refresh()),
    vscode.commands.registerCommand('techdocsEditor.signIn', () => mine.signIn()),
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
    vscode.commands.registerCommand('techdocsEditor.openVisual', (target?: vscode.Uri | DocsItem) => {
      // Do botão da árvore chega o item da página, não o arquivo
      const uri = (target instanceof DocsItem ? target.uri : target) ?? vscode.window.activeTextEditor?.document.uri;
      if (uri) return vscode.commands.executeCommand('vscode.openWith', uri, VisualEditorProvider.viewType);
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
    vscode.commands.registerCommand('techdocsEditor.renameItem', (item?: DocsItem) => treeActions.rename(item)),
    vscode.commands.registerCommand('techdocsEditor.duplicatePage', (item?: DocsItem) => treeActions.duplicate(item)),
    vscode.commands.registerCommand('techdocsEditor.moveItem', (item?: DocsItem) => treeActions.moveTo(item)),
    vscode.commands.registerCommand('techdocsEditor.moveUp', (item?: DocsItem) => treeActions.moveUp(item)),
    vscode.commands.registerCommand('techdocsEditor.moveDown', (item?: DocsItem) => treeActions.moveDown(item)),
    vscode.commands.registerCommand('techdocsEditor.deleteItem', (item?: DocsItem) => treeActions.delete(item)),
    vscode.commands.registerCommand('techdocsEditor.newSection', (item?: DocsItem) => treeActions.newSection(item)),
    vscode.commands.registerCommand('techdocsEditor.addToMenu', (item?: DocsItem) => treeActions.addToMenu(item)),
    // Os mesmos comandos com os nomes do menu ⋯ da árvore ("Nova página nesta seção", "Excluir seção"…)
    vscode.commands.registerCommand('techdocsEditor.tree.openVisual', (item?: DocsItem) => {
      const page = item ?? docs.selected();
      if (page?.kind === 'page') return vscode.commands.executeCommand('techdocsEditor.openVisual', page);
    }),
    vscode.commands.registerCommand('techdocsEditor.tree.openText', (item?: DocsItem) => vscode.commands.executeCommand('techdocsEditor.openText', item ?? docs.selected())),
    vscode.commands.registerCommand('techdocsEditor.tree.newPage', (item?: DocsItem) => vscode.commands.executeCommand('techdocsEditor.newPage', item ?? docs.selected())),
    vscode.commands.registerCommand('techdocsEditor.tree.newSection', (item?: DocsItem) => treeActions.newSection(item)),
    vscode.commands.registerCommand('techdocsEditor.tree.deleteSection', (item?: DocsItem) => treeActions.delete(item)),
    vscode.commands.registerCommand('techdocsEditor.undoTreeEdit', () => treeActions.undo()),
    vscode.commands.registerCommand('techdocsEditor.filterTree', async () => {
      // A busca da própria árvore do VS Code (a mesma do Ctrl+F nela)
      await vscode.commands.executeCommand('techdocsEditor.docs.focus');
      await vscode.commands.executeCommand('list.find');
    }),
    vscode.commands.registerCommand('techdocsEditor.openText', (target?: vscode.Uri | DocsItem) => {
      const uri = target instanceof DocsItem ? target.uri : target;
      const file = uri ?? activeCustomEditorUri();
      if (file) return vscode.commands.executeCommand('vscode.openWith', file, 'default', vscode.ViewColumn.Beside);
    }),
  );
  // Usado pelos testes de integração (test/vscode)
  return { provider, treeActions, sites, lint, docs, mine, publish, newPage, newSite, repoCheck, checkView, central, catalogOptions, prepare, preview, remotes, remoteFs, opener, conflicts, useTestSiteChoice, useTestHistoryPick, useTestSitePick, useTestAnswers };
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
