import * as vscode from 'vscode';
import {
  buildSitePages,
  codeownersOwner,
  emptyEdits,
  isTemplateSupported,
  LINT_CONFIG_FILES,
  moveNavEntry,
  newPagePath,
  newSectionPage,
  pageTitle,
  PlanEdits,
  PlanFile,
  PlanInput,
  PlanNavEntry,
  planSite,
  ReadmeUse,
  SitePage,
  SitePlan,
  SETUP_MARKDOWNLINT,
  techdocsRefAnnotation,
  today,
} from '@edtroleis/techdocs-editor-core';
import { catalogModeFor, repositoryFolder } from '../catalogOptions';
import { configDirs } from '../lintProblems';
import { existingPages, findReadme, folderName, isHome, NewSiteCommand, relative } from './newSite';
import { exists, ownerFromCatalog, PageChoice, readText, SiteChoice, templateFolders } from './templateSources';

/** O que o webview da prévia desenha. */
export type PreviewState = { status: 'idle' } | { status: 'ready'; view: PreviewView };

export type PreviewView = {
  folder: string;
  templates: { id: string; name: string; origin: SiteChoice['origin'] }[];
  /** '' = nenhum template (só as páginas que já existem em `docs/`). */
  template: string;
  allowNone: boolean;
  siteName: string;
  siteNameFrom: string;
  owner: string;
  ownerFrom?: string;
  /** O dono é pedido: o `catalog-info.yaml` vai ser criado. */
  ownerRequired: boolean;
  readme?: { path: string; use: ReadmeUse };
  pageTypes: { id: string; name: string }[];
  files: Omit<PlanFile, 'content'>[];
  nav: PlanNavEntry[];
  missing: SitePlan['missing'];
  selected?: string;
  error?: string;
  busy: boolean;
};

export type PreviewMessage =
  | { type: 'ready' }
  | { type: 'set'; field: 'template' | 'siteName' | 'owner' | 'readme'; value: string }
  | { type: 'toggle'; path: string; on: boolean }
  | { type: 'replace'; path: string; replace: boolean }
  | { type: 'move'; key: string; delta?: number; before?: string }
  | { type: 'rename'; key: string; title: string }
  | { type: 'add'; text: string; by: 'path' | 'title'; section?: string; template?: string; hint?: boolean }
  | { type: 'addSection'; name: string }
  | { type: 'remove'; path: string }
  | { type: 'open'; path: string }
  | { type: 'create' }
  | { type: 'cancel' };

export const PREVIEW_SCHEME = 'techdocs-preview';
const DOCS_DIR = 'docs';
const CODEOWNERS = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];

/** O que foi lido da pasta ao abrir a prévia. */
type Context = {
  root: vscode.Uri;
  choices: SiteChoice[];
  pageTemplates: PageChoice[];
  existing: { path: string; title?: string }[];
  readme?: { uri: vscode.Uri; text: string };
  /** O `catalog-info.yaml` a criar (a pasta não tem um e o modo não é `off`). */
  catalogName?: string;
  /** Nenhum `.markdownlint.*` na pasta do site nem acima dela: a prévia cria um. */
  lint: boolean;
  siteNameFrom: string;
  ownerFrom?: string;
};

const CATALOG_FILE = 'catalog-info.yaml';
const LINT_FILE = '.markdownlint.yaml';

/**
 * Prévia da documentação nova (layout validado em 2026-10-29), na barra lateral TechDocs: template, nome, dono e
 * README no topo; a árvore dos arquivos ou o menu, que dá para desmarcar, reordenar, renomear e completar; o texto de
 * cada arquivo abre num editor só de leitura. Nada é gravado antes do "Criar", e nunca por cima de um arquivo.
 */
export class SitePreview implements vscode.WebviewViewProvider, vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly viewId = 'techdocsEditor.preview';

  private view: vscode.WebviewView | undefined;
  private context: Context | undefined;
  private template = '';
  private siteName = '';
  private owner = '';
  private readmeUse: ReadmeUse = 'copy';
  private edits: PlanEdits = emptyEdits();
  private selected: string | undefined;
  private error: string | undefined;
  private busy = false;
  private plan: SitePlan | undefined;
  /** Páginas do template escolhido, pelo id e pelos valores dos campos. */
  private templatePages = new Map<string, SitePage[] | Error>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly newSite: NewSiteCommand,
  ) {
    this.disposables.push(vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, this));
    void this.setOpen(false);
  }

  /** Para os testes de integração: o plano do momento e as mensagens como se viessem do webview. */
  get current(): SitePlan | undefined {
    return this.plan;
  }

  async send(message: PreviewMessage) {
    await this.onMessage(message);
  }

  /** Abre a prévia para criar a documentação na pasta `root`. */
  async open(root: vscode.Uri) {
    const workspace = vscode.workspace.getWorkspaceFolder(root)?.uri;
    const repository = repositoryFolder(root);
    const folders = templateFolders(root, root);
    const { repository: own, central, builtIn } = await this.newSite.siteChoices(folders, root);
    const choices = [...own, ...central, ...builtIn].filter(c => isTemplateSupported(c.template));
    const pageTemplates = await this.newSite.pageChoices(folders, root);

    const docsDir = vscode.Uri.joinPath(root, DOCS_DIR);
    const paths = await existingPages(docsDir);
    const existing = [];
    for (const path of paths) existing.push({ path, title: pageTitle((await readText(vscode.Uri.joinPath(docsDir, path))) ?? '') });
    const readme = paths.some(isHome) ? undefined : await findReadme(root);

    const catalogMode = (await catalogModeFor(repository)).mode;
    const hasCatalog = (await exists(vscode.Uri.joinPath(root, 'catalog-info.yaml'))) || (workspace && (await exists(vscode.Uri.joinPath(workspace, 'catalog-info.yaml'))));
    const readmeTitle = readme && pageTitle(readme.text);

    let owner = await ownerFromCatalog([root, workspace]);
    let ownerFrom = owner ? 'catalog-info.yaml' : undefined;
    // O CODEOWNERS da pasta do site, senão o da raiz do repositório
    const owners = owner ? [] : [root, ...(repository && repository.path !== root.path ? [repository] : [])].flatMap(dir => CODEOWNERS.map(path => vscode.Uri.joinPath(dir, path)));
    for (const uri of owners) {
      const text = await readText(uri);
      owner = text ? codeownersOwner(text) : undefined;
      if (owner) {
        ownerFrom = 'CODEOWNERS';
        break;
      }
    }

    // Como o lint da extensão e o markdownlint-cli2 da pipeline: a pasta do site e as de cima
    const lintDirs = configDirs(root.path, (workspace ?? root).path);
    let lintFound = false;
    for (const dir of lintDirs) {
      for (const name of LINT_CONFIG_FILES) lintFound ||= await exists(root.with({ path: `${dir}/${name}` }));
    }

    this.context = {
      root,
      choices,
      pageTemplates,
      existing,
      readme,
      catalogName: hasCatalog || catalogMode === 'off' ? undefined : folderName(repository ?? root),
      lint: !lintFound,
      siteNameFrom: readmeTitle ? 'README.md' : vscode.l10n.t('folder name'),
      ownerFrom,
    };
    this.template = existing.length ? '' : (choices[0]?.template.id ?? '');
    this.siteName = readmeTitle ?? folderName(root);
    this.owner = owner ?? '';
    this.readmeUse = 'copy';
    this.edits = emptyEdits();
    // Sem dono achado, o catalog-info.yaml começa desmarcado: o Criar já vale (quem quer o catálogo marca e preenche)
    if (this.context.catalogName !== undefined && !owner && catalogMode !== 'required') this.edits.off = [CATALOG_FILE];
    this.selected = 'docs/index.md';
    this.error = undefined;
    this.busy = false;
    this.templatePages.clear();
    await this.setOpen(true);
    await vscode.commands.executeCommand(`${SitePreview.viewId}.focus`);
    this.update();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((message: PreviewMessage) => this.onMessage(message), undefined, this.disposables);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.plan?.files.find(f => f.path === uri.path.slice(1))?.content ?? '';
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  private async onMessage(message: PreviewMessage) {
    if (message.type === 'ready') return this.post();
    if (!this.context || this.busy) return;
    const edits = this.edits;
    switch (message.type) {
      case 'set':
        if (message.field === 'template') {
          // Outro template: o que foi mexido nas páginas dele não vale mais; as páginas acrescentadas e o catálogo ficam
          this.template = message.value;
          this.edits = { ...emptyEdits(), added: edits.added, off: edits.off.filter(p => p === CATALOG_FILE || p === LINT_FILE) };
        } else if (message.field === 'siteName') this.siteName = message.value;
        else if (message.field === 'owner') this.owner = message.value;
        else this.readmeUse = message.value as ReadmeUse;
        break;
      case 'toggle':
        edits.off = edits.off.filter(p => p !== message.path).concat(message.on ? [] : [message.path]);
        break;
      case 'replace':
        edits.replace = edits.replace.filter(p => p !== message.path).concat(message.replace ? [message.path] : []);
        this.selected = `${DOCS_DIR}/${message.path}`;
        break;
      case 'move':
        if (this.plan) edits.order = moveNavEntry(this.plan.nav, message.key, message.before ? { before: message.before } : { delta: message.delta ?? 0 });
        break;
      case 'rename': {
        const title = message.title.trim();
        if (!title) break;
        if (message.key.startsWith('section:')) {
          const original = message.key.slice('section:'.length);
          edits.sections[original] = title;
        } else edits.titles[message.key] = title;
        break;
      }
      case 'add': {
        if (!this.plan) break;
        const template = this.context.pageTemplates.find(p => p.template.id === message.template)?.template;
        const page = newPagePath(message.text, { by: message.by, section: message.section, template }, this.plan);
        if (message.hint) {
          void this.view?.webview.postMessage({ type: 'hint', text: page ? hintFor(page) : '' });
          return;
        }
        if (!page) return;
        edits.added.push(page);
        this.selected = `${DOCS_DIR}/${page.path}`;
        break;
      }
      case 'addSection': {
        const page = this.plan && newSectionPage(message.name, this.plan);
        if (!page) return;
        edits.added.push(page);
        this.selected = `${DOCS_DIR}/${page.path}`;
        break;
      }
      case 'remove':
        edits.added = edits.added.filter(p => p.path !== message.path);
        break;
      case 'open':
        this.selected = message.path;
        this.update();
        return this.show(message.path);
      case 'create':
        return this.create();
      case 'cancel':
        return this.close();
    }
    this.update();
  }

  /** Refaz o plano e o manda ao webview; os textos abertos na prévia acompanham. */
  private update() {
    const context = this.context;
    if (!context) return;
    this.error = undefined;
    const pages = this.pagesOf(this.template);
    if (pages instanceof Error) this.error = pages.message;
    const choice = context.choices.find(c => c.template.id === this.template);
    const input: PlanInput = {
      siteName: this.siteName,
      docsDir: DOCS_DIR,
      template: choice && Array.isArray(pages) ? { pages, nav: choice.template.nav, mkdocs: choice.template.mkdocs } : undefined,
      existing: context.existing,
      readme: context.readme && {
        path: relativeTo(context.root, context.readme.uri),
        text: context.readme.text,
        use: this.readmeUse,
        pointer: vscode.l10n.t('The documentation of this repository is in [docs/](docs/index.md), published by TechDocs.'),
      },
      catalog: context.catalogName !== undefined ? { name: context.catalogName, owner: this.owner, annotation: techdocsRefAnnotation('', '') } : undefined,
      lint: context.lint ? SETUP_MARKDOWNLINT : undefined,
      pageTemplates: context.pageTemplates.map(p => p.template),
      values: this.values(),
      edits: this.edits,
    };
    this.plan = planSite(input);
    for (const document of vscode.workspace.textDocuments) if (document.uri.scheme === PREVIEW_SCHEME) this.changed.fire(document.uri);
    this.post();
  }

  private values(): Record<string, string> {
    return { date: today(), site_name: this.siteName.trim(), owner: this.owner.trim() };
  }

  /** As páginas do template com os campos preenchidos (os declarados, pelos padrões); um Error se o template está incompleto. */
  private pagesOf(id: string): SitePage[] | Error | undefined {
    const choice = this.context?.choices.find(c => c.template.id === id);
    if (!choice) return undefined;
    const key = `${id}\n${this.siteName}\n${this.owner}`;
    let pages = this.templatePages.get(key);
    if (!pages) {
      const sources = this.sourcesOf(choice);
      if (!sources) return undefined;
      const defaults = Object.fromEntries([...sources.pageFields, ...choice.template.fields].map(f => [f.name, f.default ?? '']));
      try {
        pages = buildSitePages(choice.template, sources.sources, { ...defaults, ...this.values() });
      } catch (error) {
        pages = new Error(vscode.l10n.t('The site template "{0}" is incomplete: {1} not found.', choice.template.name, (error as Error).message));
      }
      this.templatePages.set(key, pages);
    }
    return pages;
  }

  private loadedSources = new Map<string, Awaited<ReturnType<NewSiteCommand['sources']>>>();

  /** Os textos do template (lidos uma vez; a primeira leitura refaz a prévia quando termina). */
  private sourcesOf(choice: SiteChoice) {
    const id = choice.template.id;
    const loaded = this.loadedSources.get(id);
    if (loaded) return loaded;
    const root = this.context!.root;
    void this.newSite.sources(choice, templateFolders(root, root), root).then(sources => {
      this.loadedSources.set(id, sources);
      if (this.context?.root === root) this.update();
    });
    return undefined;
  }

  /** O texto do arquivo: o da prévia (só leitura) ou, se ele não muda, o que está no disco. */
  private async show(path: string) {
    const file = this.plan?.files.find(f => f.path === path);
    if (!file || !this.context) return;
    const uri = file.content === undefined ? vscode.Uri.joinPath(this.context.root, path) : vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${path}` });
    await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true });
  }

  /** Grava o que está marcado: as páginas, o `catalog-info.yaml`, o README e, por último, o `mkdocs.yml`. */
  private async create() {
    const { context, plan } = this;
    if (!context || !plan || plan.missing.length || this.error) return;
    const writes = plan.files.filter(f => f.included && f.content !== undefined && f.status !== 'unchanged');
    for (const name of ['mkdocs.yml', 'mkdocs.yaml']) {
      if (await exists(vscode.Uri.joinPath(context.root, name))) return this.fail(vscode.l10n.t('There is already a {0} in {1}.', name, relative(context.root)));
    }
    // Nunca por cima de um arquivo, menos o que a pessoa escolheu substituir (ou o README movido)
    const taken = [];
    for (const file of writes) if (file.status === 'new' && (await exists(vscode.Uri.joinPath(context.root, file.path)))) taken.push(file.path);
    if (taken.length) return this.fail(vscode.l10n.t('These files already exist in {0}: {1}', relative(context.root), taken.join(', ')));

    this.busy = true;
    this.post();
    const encoder = new TextEncoder();
    const mkdocs = vscode.Uri.joinPath(context.root, 'mkdocs.yml');
    try {
      for (const file of [...writes.filter(f => f.path !== 'mkdocs.yml'), ...writes.filter(f => f.path === 'mkdocs.yml')]) {
        const uri = vscode.Uri.joinPath(context.root, file.path);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, encoder.encode(file.content!));
      }
    } catch (error) {
      this.busy = false;
      return this.fail((error as Error).message);
    }
    const home = plan.files.find(f => f.included && f.path.startsWith(`${DOCS_DIR}/`) && isHome(f.path.slice(DOCS_DIR.length + 1)))
      ?? plan.files.find(f => f.included && f.path.startsWith(`${DOCS_DIR}/`));
    await this.close();
    await this.newSite.finish(context.root, mkdocs, home && vscode.Uri.joinPath(context.root, home.path));
  }

  private fail(message: string) {
    this.error = message;
    this.post();
  }

  private async close() {
    this.context = undefined;
    this.plan = undefined;
    this.busy = false;
    this.loadedSources.clear();
    this.templatePages.clear();
    // As abas da prévia (só leitura) não servem mais
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputText && t.input.uri.scheme === PREVIEW_SCHEME);
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
    await this.setOpen(false);
    this.post();
  }

  private async setOpen(open: boolean) {
    await vscode.commands.executeCommand('setContext', 'techdocsEditor.preview', open);
  }

  private state(): PreviewState {
    const { context, plan } = this;
    if (!context || !plan) return { status: 'idle' };
    return {
      status: 'ready',
      view: {
        folder: relative(context.root),
        templates: context.choices.map(c => ({ id: c.template.id, name: c.template.name, origin: c.origin })),
        template: this.template,
        allowNone: context.existing.length > 0,
        siteName: this.siteName,
        siteNameFrom: context.siteNameFrom,
        owner: this.owner,
        ownerFrom: context.ownerFrom,
        ownerRequired: plan.files.some(f => f.origin === 'catalog' && f.included),
        readme: context.readme && { path: relativeTo(context.root, context.readme.uri), use: this.readmeUse },
        pageTypes: context.pageTemplates.map(p => ({ id: p.template.id, name: p.template.name })),
        files: plan.files.map(({ content: _content, ...file }) => file),
        nav: plan.nav,
        missing: plan.missing,
        selected: this.selected,
        error: this.error,
        busy: this.busy,
      },
    };
  }

  private post() {
    void this.view?.webview.postMessage({ type: 'state', state: this.state(), labels: previewLabels() });
  }

  private html(webview: vscode.Webview, media: vscode.Uri) {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'preview.js'));
    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${PREVIEW_CSS}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

const relativeTo = (root: vscode.Uri, uri: vscode.Uri) => uri.path.slice(root.path.replace(/\/+$/, '').length + 1);

function hintFor(page: { path: string; title: string; section?: string }) {
  return vscode.l10n.t('{0} · in the menu: {1}', `${DOCS_DIR}/${page.path}`, page.section ? `${page.section} › ${page.title}` : page.title);
}

/** Textos do webview da prévia (o webview não tem `vscode.l10n`). */
export function previewLabels() {
  return {
    idle: vscode.l10n.t('Nothing to preview.'),
    template: vscode.l10n.t('Template'),
    noTemplate: vscode.l10n.t('None (only the pages in docs/)'),
    siteName: vscode.l10n.t('Site name'),
    owner: vscode.l10n.t('Owner'),
    optional: vscode.l10n.t('optional'),
    suggestedFrom: vscode.l10n.t('Suggested from {0}'),
    notFoundOwner: vscode.l10n.t('No CODEOWNERS or catalog-info.yaml found'),
    ownerOptional: vscode.l10n.t('Only catalog-info.yaml needs the owner, and it is unchecked.'),
    readme: vscode.l10n.t('README.md'),
    readmeCopy: vscode.l10n.t('Copy as the home page'),
    readmeMove: vscode.l10n.t('Move (the README becomes a link)'),
    readmeSkip: vscode.l10n.t('Do not use'),
    files: vscode.l10n.t('Files'),
    menu: vscode.l10n.t('Menu'),
    filesHint: vscode.l10n.t('uncheck what you do not want'),
    menuHint: vscode.l10n.t('drag · double-click renames'),
    addPage: vscode.l10n.t('+ Page'),
    addSection: vscode.l10n.t('+ Section'),
    addPageTitle: vscode.l10n.t('Add page'),
    addPageIn: vscode.l10n.t('Add page in {0}'),
    pathPlaceholder: vscode.l10n.t('Page name (guides/Name puts it in a folder)'),
    titlePlaceholder: vscode.l10n.t('Page title'),
    sectionPlaceholder: vscode.l10n.t('Section name'),
    pageType: vscode.l10n.t('Kind of page'),
    freePage: vscode.l10n.t('Free page'),
    addKeys: vscode.l10n.t('Enter creates · Esc cancels'),
    remove: vscode.l10n.t('Remove'),
    up: vscode.l10n.t('Move up'),
    down: vscode.l10n.t('Move down'),
    section: vscode.l10n.t('section'),
    rename: vscode.l10n.t('Double-click to rename'),
    include: vscode.l10n.t('Include {0}'),
    required: vscode.l10n.t('Needed for the site'),
    keep: vscode.l10n.t('Keep current'),
    replace: vscode.l10n.t('Use the template one'),
    exists: vscode.l10n.t('already exists'),
    replaced: vscode.l10n.t('replaced by the template'),
    fromReadmeCopy: vscode.l10n.t('copied from README.md'),
    fromReadmeMove: vscode.l10n.t('moved from README.md'),
    readmeStays: vscode.l10n.t('stays as it is'),
    readmeLink: vscode.l10n.t('becomes a link to the docs'),
    addedByYou: vscode.l10n.t('added by you'),
    lintRules: vscode.l10n.t('Markdown rules, used here and in the pipeline'),
    newFile: vscode.l10n.t('New'),
    modifiedFile: vscode.l10n.t('Modified'),
    fillSiteName: vscode.l10n.t('Fill in the site name.'),
    fillOwner: vscode.l10n.t('Fill in the owner or uncheck catalog-info.yaml.'),
    fill: vscode.l10n.t('fill in'),
    summary: vscode.l10n.t('{0} new, {1} modified · nothing written yet'),
    create: vscode.l10n.t('Create'),
    cancel: vscode.l10n.t('Cancel'),
    creating: vscode.l10n.t('Creating…'),
  };
}

export type PreviewLabels = ReturnType<typeof previewLabels>;

const PREVIEW_CSS = `
body { padding: 0 0 8px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.fields { padding: 4px 12px 10px 20px; display: grid; gap: 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); }
.field { display: grid; gap: 2px; }
.field > label { font-size: 12px; color: var(--vscode-descriptionForeground); }
input, select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 3px 6px; min-width: 0; }
select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border-color: var(--vscode-dropdown-border, transparent); }
input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
input.missing { border-color: var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); }
.from { font-size: 11px; color: var(--vscode-descriptionForeground); opacity: .8; }
.viewbar { display: flex; align-items: center; gap: 8px; padding: 8px 8px 4px 20px; }
.seg { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: 3px; overflow: hidden; }
.seg button { font: 12px var(--vscode-font-family); color: var(--vscode-descriptionForeground); background: none; border: none; padding: 2px 10px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link { font: inherit; color: var(--vscode-textLink-foreground); background: none; border: none; cursor: pointer; padding: 0 2px; }
.link:hover { text-decoration: underline; }
.row { display: flex; align-items: center; gap: 6px; min-height: 22px; padding-right: 8px; cursor: pointer; white-space: nowrap; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.sel { background: var(--vscode-list-inactiveSelectionBackground); }
.row.off .name, .row.off .desc { opacity: .5; text-decoration: line-through; }
.row input[type=checkbox] { margin: 0; flex-shrink: 0; }
.spacer { width: 13px; flex-shrink: 0; }
.ic { width: 18px; flex-shrink: 0; font-size: 11px; font-family: var(--vscode-editor-font-family); text-align: center; color: var(--vscode-symbolIcon-fileForeground, var(--vscode-foreground)); }
.ic.dir { color: var(--vscode-symbolIcon-folderForeground, var(--vscode-descriptionForeground)); }
.name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.desc { color: var(--vscode-descriptionForeground); font-size: 12px; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
.end { margin-left: auto; display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.badge { font: 600 11px var(--vscode-editor-font-family); }
.row.new .name, .badge.n { color: var(--vscode-gitDecoration-addedResourceForeground); }
.row.mod .name, .badge.m { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.badge.c { color: var(--vscode-editorWarning-foreground); }
.handle { width: 12px; flex-shrink: 0; text-align: center; letter-spacing: -2px; color: var(--vscode-descriptionForeground); opacity: .6; cursor: grab; }
.move { display: none; }
.row:hover .move, .row:focus-within .move { display: flex; }
.move button, .x { font: 12px var(--vscode-font-family); background: none; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0 3px; }
.move button:hover, .x:hover { color: var(--vscode-foreground); }
.row.drop-before { box-shadow: inset 0 2px 0 var(--vscode-focusBorder); }
.conflict { display: flex; gap: 4px; padding: 2px 8px 4px 0; }
.conflict button { font: 11px var(--vscode-font-family); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 1px solid transparent; border-radius: 2px; padding: 1px 8px; cursor: pointer; }
.conflict button[aria-pressed="true"] { border-color: var(--vscode-editorWarning-foreground); }
.edit { flex: 1; width: 100%; }
.addhint { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 8px 6px 0; min-width: 0; }
.addhint span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.addrow { display: flex; gap: 14px; padding: 6px 8px 4px 20px; }
.foot { display: grid; gap: 6px; padding: 10px 12px 4px 20px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border)); margin-top: 6px; }
.warnline { font-size: 12px; color: var(--vscode-editorWarning-foreground); }
.error { font-size: 12px; color: var(--vscode-errorForeground); border-left: 3px solid var(--vscode-errorForeground); padding-left: 8px; }
.summary { font-size: 12px; color: var(--vscode-descriptionForeground); }
.btn { padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; }
.btn:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.btn.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
.btn:disabled { opacity: .5; cursor: default; }
:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
`;
