import * as vscode from 'vscode';
import { useE2eToken, useTestTransport } from './publish/githubAuth';
import { chooseSites, hideSite, useTestSiteChoice } from './chooseSites';
import { CatalogOptions } from './catalogOptions';
import { timing, watchLag } from './timing';
import { CheckView } from './checkView';
import { DOCS_EXPLORER_VIEW, DocsItem, DocsTreeView, useTestSitePick } from './docsTreeView';
import { LintActions } from './lintActions';
import { LintService } from './lintService';
import { LocalSites } from './localSites';
import { openVisualByDefault } from './openByDefault';
import { ProposedChanges } from './proposedChange';
import { PrepareContext } from './prepareContext';
import { CloneFlow } from './clone/cloneFlow';
import { SettingsView } from './settingsView';
import { SendService } from './send/sendService';
import { SendView } from './send/sendView';
import { RepoCheck } from './repoCheck';
import { PASTE_KIND, PasteAsMarkdown } from './pasteMarkdown';
import { CentralTemplates } from './templates/centralTemplates';
import { NewPageCommand } from './templates/newPage';
import { NewSiteCommand } from './templates/newSite';
import { SitePreview } from './templates/sitePreview';
import { TreeActions, useTestAnswers } from './treeActions';
import { ExplorerSync } from './explorerSync';
import { VisualEditorProvider } from './visualEditorProvider';
import { registerTemplateExamples } from './templates/templateExamples';
import { TemplateOptions } from './templates/templateOptions';
import { templateLanguage } from '@edtroleis/techdocs-editor-core/src/builtInTemplates';

export function activate(context: vscode.ExtensionContext) {
  // Cenários de usuário (e2e/scenarios): login no GitHub por token, nunca na extensão publicada. No navegador não há
  // `process`: lido pelo globalThis
  if (context.extensionMode !== vscode.ExtensionMode.Production) {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    useE2eToken(env?.TECHDOCS_EDITOR_E2E_GITHUB_TOKEN);
  }
  const sites = new LocalSites();
  const lint = new LintService(sites);
  // Abrir documentação do GitHub: clona e abre (spec 09); a página do link abre quando o diretório abrir
  const clone = new CloneFlow({ state: context.globalState });
  void clone.openPending();
  const provider = new VisualEditorProvider(context.extensionUri, lint, sites);
  const treeActions = new TreeActions();
  const explorerSync = new ExplorerSync(sites);
  treeActions.renameFile = (from, to) => explorerSync.renameQuietly(from, to);
  treeActions.selectTitle = async (uri, title) => (await provider.session(uri))?.select(title);
  const docs = new DocsTreeView(sites, context.workspaceState, treeActions, lint);
  treeActions.use(docs);
  provider.linkPages = async uri => [...docs.linkTargets(uri), ...(await docs.docLinks(uri).catch(() => []))];
  provider.pageKinds = uri => newPage.kinds(uri);
  provider.pageKindText = (uri, id, title) => newPage.kindText(uri, id, title);
  const central = new CentralTemplates(context);
  const newPage = new NewPageCommand(sites, provider, central);
  const proposals = new ProposedChanges();
  const newSite = new NewSiteCommand(central, proposals);
  newSite.useSites(sites);
  const repoCheck = new RepoCheck(sites, lint, newSite, proposals);
  const checkView = new CheckView(repoCheck);
  const catalogOptions = new CatalogOptions(repoCheck);
  const templateOptions = new TemplateOptions(central, repoCheck);
  const preview = new SitePreview(context.extensionUri, newSite);
  newSite.usePreview(preview);
  const prepare = new PrepareContext(sites);
  context.subscriptions.push(
    registerTemplateExamples(),
    // Os itens antigos (listas no topo da tela) agora abrem a janela Configurações do TechDocs
    vscode.commands.registerCommand('techdocsEditor.templateOptions', () => vscode.commands.executeCommand('techdocsEditor.settings')),
    vscode.window.registerUriHandler({
      handleUri: async uri => {
        await clone.fromLink(uri);
      },
    }),
    vscode.commands.registerCommand('techdocsEditor.openRemote', (input?: string) => clone.fromInput(typeof input === 'string' ? input : undefined)),
    vscode.commands.registerCommand('techdocsEditor.chooseSites', () => chooseSites(sites)),
    vscode.commands.registerCommand('techdocsEditor.hideSite', (item?: DocsItem) => hideSite(sites, item?.siteRoot)),
    vscode.commands.registerCommand('techdocsEditor.chooseSite', () => docs.chooseSite()),
    // Mexer nos arquivos das docs pelo Explorer do VS Code: o menu do site e os links acompanham
    explorerSync,
    // Parado sem rodar nada: registrado no canal, para separar lentidão da extensão de processo ocupado
    watchLag(),
    // Clique direito num diretório do Explorer: a árvore passa ao site dele (ou à tela de criar a documentação)
    vscode.commands.registerCommand('techdocsEditor.openInTechDocs', async (uri?: vscode.Uri) => {
      if (!(uri instanceof vscode.Uri)) return;
      await sites.discover(uri);
      const inside = sites.list().filter(({ site }) => site.root === uri.path || site.root.startsWith(`${uri.path.replace(/\/+$/, '')}/`));
      // Do Explorer: a seção TechDocs dele, embaixo dos arquivos
      await vscode.commands.executeCommand(`${DOCS_EXPLORER_VIEW}.focus`);
      const own = inside.find(({ site }) => site.root === uri.path);
      if (own ?? inside.length === 1) return docs.select((own ?? inside[0]).mkdocs.toString());
      // Vários sites dentro: a troca de diretório, já nele
      if (inside.length) return docs.chooseSite(uri);
      return docs.selectFolder(uri);
    }),
    // A tela da pasta sem documentação: um botão só, que abre na seção a janela com o tipo de documentação em cartões
    // (Em branco, API, Docs de serviço…) e o que vai ser criado. `how` 'blank' cria direto (os testes)
    vscode.commands.registerCommand('techdocsEditor.createHere', async (how?: 'blank' | 'template') => {
      const folder = docs.folderWithoutDocs;
      if (!folder) return undefined;
      const choice = typeof how === 'string' ? how : 'template';
      if (choice === 'template') return newSite.run(folder);
      if (choice !== 'blank') return undefined;
      // A barra de progresso na seção desde o clique; os tempos no canal "TechDocs Editor"
      return vscode.window.withProgress({ location: { viewId: docs.shownViewId } }, async () => {
        timing.begin('Criar a documentação');
        try {
          const result = await newSite.quick(folder);
          await docs.ready;
          timing.step('árvore montada');
          return result;
        } finally {
          timing.end();
        }
      });
    }),
    proposals,
    repoCheck,
    checkView,
    prepare,
    docsPageContext(sites),
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
    provider,
    // O webview repassa toda tecla para os atalhos do VS Code: os do editor visual (Ctrl+B negrito, Ctrl+E código…)
    // também esconderiam a barra lateral ou abririam o Quick Open, e o foco sairia do texto. Já tratados no webview,
    // ficam presos aqui enquanto o foco está nele (package.json, keybindings)
    vscode.commands.registerCommand('techdocsEditor.visual.keepKey', () => undefined),
    vscode.commands.registerCommand('techdocsEditor.openVisual', (target?: vscode.Uri | DocsItem) => {
      // Do botão da árvore chega o item da página, não o arquivo
      const uri = (target instanceof DocsItem ? target.uri : target) ?? vscode.window.activeTextEditor?.document.uri;
      if (uri) return vscode.commands.executeCommand('vscode.openWith', uri, VisualEditorProvider.viewType);
    }),
    // + New page: em branco, sem perguntar (os modelos ficam no / e no botão TechDocs do editor visual)
    vscode.commands.registerCommand('techdocsEditor.newPage', (target?: unknown) => treeActions.newPage(target)),
    vscode.workspace.onDidSaveTextDocument(document => void treeActions.followTitle(document)),
    vscode.commands.registerCommand('techdocsEditor.newSite', (target?: vscode.Uri) =>
      newSite.run(target instanceof vscode.Uri ? target : undefined),
    ),
    vscode.commands.registerCommand('techdocsEditor.refreshTemplates', () => refreshCentralTemplates(central)),
    // Colar HTML (Confluence, Outline, páginas web) no editor de texto: vira Markdown (spec 05, C12)
    vscode.languages.registerDocumentPasteEditProvider({ language: 'markdown' }, new PasteAsMarkdown(sites), {
      providedPasteEditKinds: [PASTE_KIND],
      pasteMimeTypes: ['text/html'],
    }),
    vscode.commands.registerCommand('techdocsEditor.checkDocs', () => repoCheck.check()),
    // O botão da árvore: o site mostrado nela
    vscode.commands.registerCommand('techdocsEditor.checkShown', () => repoCheck.checkShown(docs.localSite?.mkdocs)),
    // A engrenagem da seção Verificação e o "Configurar…" do item sem catalog-info.yaml
    vscode.commands.registerCommand('techdocsEditor.checkOptions', () => vscode.commands.executeCommand('techdocsEditor.settings')),
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
    vscode.commands.registerCommand('techdocsEditor.usePageTitle', (item?: DocsItem) => treeActions.usePageTitle(item)),
    vscode.commands.registerCommand('techdocsEditor.createMissingPage', (item?: DocsItem) => treeActions.createMissing(item)),
    vscode.commands.registerCommand('techdocsEditor.tree.openMissing', (item?: DocsItem) => treeActions.openMissing(item)),
    vscode.commands.registerCommand('techdocsEditor.removeFromMenu', (item?: DocsItem) => treeActions.removeFromMenu(item)),
    // Os mesmos comandos com os nomes do menu ⋯ da árvore ("Nova página nesta seção", "Excluir seção"…)
    vscode.commands.registerCommand('techdocsEditor.tree.openVisual', (item?: DocsItem) => {
      const page = item ?? docs.selected();
      if (page?.kind === 'page') return vscode.commands.executeCommand('techdocsEditor.openVisual', page);
    }),
    vscode.commands.registerCommand('techdocsEditor.tree.openText', (item?: DocsItem) => vscode.commands.executeCommand('techdocsEditor.openText', item ?? docs.selected())),
    vscode.commands.registerCommand('techdocsEditor.tree.openToSide', (item?: DocsItem) => {
      const target = item ?? docs.selected();
      if (target?.uri) return vscode.commands.executeCommand('vscode.open', target.uri, vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand('techdocsEditor.copyToPage', (uri?: vscode.Uri) => treeActions.copyToPage(uri)),
    vscode.commands.registerCommand('techdocsEditor.tree.newPage', (item?: DocsItem) => vscode.commands.executeCommand('techdocsEditor.newPage', item ?? docs.selected())),
    vscode.commands.registerCommand('techdocsEditor.tree.newSection', (item?: DocsItem) => treeActions.newSection(item)),
    vscode.commands.registerCommand('techdocsEditor.tree.deleteSection', (item?: DocsItem) => treeActions.delete(item)),
    vscode.commands.registerCommand('techdocsEditor.undoTreeEdit', () => treeActions.undo()),
    vscode.commands.registerCommand('techdocsEditor.filterTree', async () => {
      // A busca da própria árvore do VS Code (a mesma do Ctrl+F nela)
      await vscode.commands.executeCommand(`${docs.shownViewId}.focus`);
      await vscode.commands.executeCommand('list.find');
    }),
    vscode.commands.registerCommand('techdocsEditor.openText', (target?: vscode.Uri | DocsItem) => {
      const uri = target instanceof DocsItem ? target.uri : target;
      const file = uri ?? activeCustomEditorUri();
      if (file) return vscode.commands.executeCommand('vscode.openWith', file, 'default', vscode.ViewColumn.Beside);
    }),
  );
  // O envio do repositório inteiro (spec 09): Enviar (N) na árvore, no editor e na barra de status; painel Envio
  const send = new SendService(context.extensionUri, sites, repoCheck, provider, count => docs.setSendBadge(count));
  const sendView = new SendView(context.extensionUri, send);
  const settingsView = new SettingsView(context.extensionUri, { templateOptions, catalogOptions, site: () => docs.localSite?.mkdocs });
  provider.onStripAction(({ uri, action }) => void send.action(uri, action));
  context.subscriptions.push(
    send,
    sendView,
    vscode.window.registerWebviewViewProvider(SendView.viewId, sendView),
    settingsView,
    vscode.window.registerWebviewViewProvider(SettingsView.viewId, settingsView),
    vscode.commands.registerCommand('techdocsEditor.settings', () => settingsView.open()),
    vscode.commands.registerCommand('techdocsEditor.settings.close', () => settingsView.close()),
    vscode.commands.registerCommand('techdocsEditor.sendOptions', () => settingsView.open()),
    vscode.commands.registerCommand('techdocsEditor.cloneOptions', () => settingsView.open()),
    vscode.commands.registerCommand('techdocsEditor.send', (target?: vscode.Uri | DocsItem) =>
      send.open(target instanceof DocsItem ? target.uri : target),
    ),
  );
  // Usado pelos testes de integração (test/vscode)
  return { useTestTransport, send, clone, provider, treeActions, sites, lint, docs, newPage, newSite, repoCheck, checkView, central, catalogOptions, templateOptions, settingsView, prepare, preview, useTestSiteChoice, useTestSitePick, useTestAnswers };
}

/**
 * `techdocsEditor.activeIsDocs`: o editor ativo é uma página de um `docs_dir` Os botões e comandos do editor
 * visual aparecem só nessas páginas, e não em qualquer Markdown (um README, por exemplo).
 */
function docsPageContext(sites: LocalSites): vscode.Disposable {
  const update = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const uri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
    const isDocs = Boolean(uri && sites.siteOf(uri));
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
  if (!(await central.source(vscode.workspace.workspaceFolders?.[0]?.uri))) {
    const open = vscode.l10n.t('Open settings');
    const answer = await vscode.window.showInformationMessage(
      vscode.l10n.t('No company templates are set. Point techdocsEditor.templates.repository to the repository with them.'),
      open,
    );
    if (answer === open) await vscode.commands.executeCommand('techdocsEditor.settings');
    return;
  }
  const result = await central.get(vscode.workspace.workspaceFolders?.[0]?.uri, true, templateLanguage(vscode.env.language));
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

