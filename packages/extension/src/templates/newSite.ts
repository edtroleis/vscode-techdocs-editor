import * as vscode from 'vscode';
import {
  buildSitePages,
  hasTechdocsRef,
  isTemplateSupported,
  SitePage,
  SiteSources,
  siteMkdocsYml,
  siteUsedFields,
  techdocsRefAnnotation,
  TemplateField,
  today,
} from '@edtroleis/techdocs-editor-core';
import { VisualEditorProvider } from '../visualEditorProvider';
import type { CentralTemplates } from './centralTemplates';
import {
  builtInEnabled,
  builtInPageTemplates,
  builtInSiteTemplates,
  exists,
  gitUserName,
  ownerFromCatalog,
  readText,
  repositoryPageTemplates,
  repositorySiteTemplates,
  SiteChoice,
  templateFolders,
} from './templateSources';

/** Respostas prontas, para os testes de integração (sem as caixas de escolha). */
export type NewSiteAnswers = { template: string; folder?: vscode.Uri; values?: Record<string, string> };

/** O que foi criado: o `mkdocs.yml` e a anotação a pôr no `catalog-info.yaml` (undefined se já está lá). */
export type NewSiteResult = { mkdocs: vscode.Uri; annotation?: string };

const MKDOCS_FILES = ['mkdocs.yml', 'mkdocs.yaml'];
/** Pasta das páginas do site novo (o padrão do MkDocs: o `mkdocs.yml` não precisa dizer). */
const DOCS_DIR = 'docs';

/**
 * "TechDocs: Novo site de documentação…" (spec 04, TP11): escolhe a pasta e o template de site, pergunta o nome
 * e os campos, cria o `mkdocs.yml` e as páginas (nunca por cima de um arquivo), abre a primeira página e mostra a
 * anotação do `catalog-info.yaml` para copiar.
 */
export class NewSiteCommand {
  constructor(private readonly central?: CentralTemplates) {}

  async run(target?: vscode.Uri, answers?: NewSiteAnswers): Promise<NewSiteResult | undefined> {
    const root = await this.resolveFolder(answers?.folder ?? target, Boolean(answers));
    if (!root) return undefined;
    for (const name of MKDOCS_FILES) {
      if (await exists(vscode.Uri.joinPath(root, name))) {
        void vscode.window.showErrorMessage(vscode.l10n.t('There is already a {0} in {1}.', name, relative(root)));
        return undefined;
      }
    }

    const folders = templateFolders(root, root);
    const choice = await this.pickTemplate(folders, root, answers?.template);
    if (!choice) return undefined;
    const { template } = choice;

    const { sources, pageFields } = await this.sources(choice, folders, root);
    const used = siteUsedFields(template, sources);
    const values = await this.fieldValues(choice, used, root, pageFields, answers?.values);
    if (!values) return undefined;

    let pages: SitePage[];
    try {
      pages = buildSitePages(template, sources, values);
    } catch (error) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('The site template "{0}" is incomplete: {1} not found.', template.name, (error as Error).message),
      );
      return undefined;
    }
    // TP4: nunca sobrescreve (uma pasta docs/ pode já existir, com outras páginas)
    const docsDir = vscode.Uri.joinPath(root, DOCS_DIR);
    const taken = [];
    for (const page of pages) if (await exists(vscode.Uri.joinPath(docsDir, page.path))) taken.push(`${DOCS_DIR}/${page.path}`);
    if (taken.length) {
      void vscode.window.showErrorMessage(vscode.l10n.t('These files already exist in {0}: {1}', relative(root), taken.join(', ')));
      return undefined;
    }

    const encoder = new TextEncoder();
    for (const page of pages) {
      const uri = vscode.Uri.joinPath(docsDir, page.path);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, encoder.encode(page.content));
    }
    // Por último: quem acompanha os mkdocs.yml (árvore, lint) já acha as páginas
    const mkdocs = vscode.Uri.joinPath(root, 'mkdocs.yml');
    await vscode.workspace.fs.writeFile(mkdocs, encoder.encode(siteMkdocsYml(values.site_name, pages, template)));

    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(docsDir, pages[0].path), VisualEditorProvider.viewType);
    const annotation = await this.catalogAnnotation(root);
    if (annotation) void this.showAnnotation(annotation, root);
    return { mkdocs, annotation: annotation?.text };
  }

  /**
   * Pasta do site: a clicada no Explorer, senão a raiz do workspace se ela não tem `mkdocs.yml`, senão a escolhida
   * numa caixa de pastas. Com respostas prontas (testes), sem caixa nenhuma.
   */
  private async resolveFolder(target: vscode.Uri | undefined, quiet: boolean): Promise<vscode.Uri | undefined> {
    if (target) {
      const type = await vscode.workspace.fs.stat(target).then(s => s.type, () => vscode.FileType.Unknown);
      return type === vscode.FileType.File ? vscode.Uri.joinPath(target, '..') : target;
    }
    const workspaces = vscode.workspace.workspaceFolders ?? [];
    if (!workspaces.length) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a folder first: the site is created inside it.'));
      return undefined;
    }
    const workspace = workspaces.length === 1 || quiet ? workspaces[0] : await vscode.window.showWorkspaceFolderPick();
    if (!workspace) return undefined;
    let taken = false;
    for (const name of MKDOCS_FILES) taken ||= await exists(vscode.Uri.joinPath(workspace.uri, name));
    if (!taken || quiet) return workspace.uri;
    const picked = await vscode.window.showOpenDialog({
      title: vscode.l10n.t('The workspace root already has a mkdocs.yml. Choose a folder for the new site'),
      defaultUri: workspace.uri,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: vscode.l10n.t('Create the site here'),
    });
    return picked?.[0];
  }

  /** Lista dos templates de site: os do repositório, com a pasta de onde vieram, os da empresa (TA3) e os da extensão. */
  private async pickTemplate(folders: vscode.Uri[], root: vscode.Uri, id: string | undefined): Promise<SiteChoice | undefined> {
    const repository = await repositorySiteTemplates(folders);
    const ids = new Set(repository.map(c => c.template.id));
    const company = await this.central?.get(root);
    const central: SiteChoice[] = (company?.sites ?? [])
      .filter(s => !ids.has(s.template.id))
      .map(s => ({ ...s, origin: 'central', source: company!.label }));
    central.forEach(c => ids.add(c.template.id));
    const builtIn = builtInEnabled(root) ? builtInSiteTemplates().filter(c => !ids.has(c.template.id)) : [];
    const choices = [...repository, ...central, ...builtIn];
    if (!choices.length) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('There are no site templates: the built-in ones are turned off and the repository has none.'),
      );
      return undefined;
    }
    let choice: SiteChoice | undefined;
    if (id) {
      choice = choices.find(c => c.template.id === id);
    } else {
      type Item = vscode.QuickPickItem & { choice?: SiteChoice };
      const items: Item[] = [];
      const groups = [repository, central, builtIn].filter(g => g.length).length;
      for (const c of choices) {
        if (groups > 1 && c === repository[0]) items.push({ label: vscode.l10n.t('This repository'), kind: vscode.QuickPickItemKind.Separator });
        if (groups > 1 && c === central[0]) items.push({ label: vscode.l10n.t('Company'), kind: vscode.QuickPickItemKind.Separator });
        if (groups > 1 && c === builtIn[0]) items.push({ label: vscode.l10n.t('Built in'), kind: vscode.QuickPickItemKind.Separator });
        items.push({
          label: c.template.name,
          description: !isTemplateSupported(c.template)
            ? vscode.l10n.t('needs a newer version of the extension')
            : c.origin === 'repository'
              ? `$(repo) ${c.source}`
              : c.origin === 'central'
                ? `$(organization) ${c.source}`
                : undefined,
          detail: c.template.description,
          choice: c,
        });
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: vscode.l10n.t('New documentation site'),
        placeHolder: vscode.l10n.t('Choose the kind of site'),
        matchOnDetail: true,
      });
      choice = picked?.choice;
    }
    if (choice && !isTemplateSupported(choice.template)) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('The template "{0}" uses a newer format. Update the TechDocs Editor extension to use it.', choice.template.name),
      );
      return undefined;
    }
    return choice;
  }

  /**
   * Texto de cada arquivo do site: `page` pelo template de página (o do repositório, o da empresa, o da extensão, mesmo
   * com `builtIn: false`, que só esconde da lista); `source` da pasta do template. Com os campos que os templates
   * de página usados declaram.
   */
  private async sources(choice: SiteChoice, folders: vscode.Uri[], root: vscode.Uri): Promise<{ sources: SiteSources; pageFields: TemplateField[] }> {
    const company = await this.central?.get(root);
    const pages = [
      ...(await repositoryPageTemplates(folders)),
      ...(company?.pages ?? []).map(template => ({ template })),
      ...builtInPageTemplates(),
    ];
    const pageOf = (id: string) => pages.find(p => p.template.id === id)?.template;
    const files: Record<string, string | undefined> = {};
    if (choice.origin !== 'repository') {
      Object.assign(files, choice.files);
    } else {
      for (const file of choice.template.files) {
        if (file.source) files[file.source] = await readText(vscode.Uri.joinPath(choice.folder, file.source));
      }
    }
    return {
      sources: file => (file.page ? pageOf(file.page)?.body : files[file.source!]),
      pageFields: choice.template.files.flatMap(file => (file.page && pageOf(file.page)?.fields) || []),
    };
  }

  /**
   * Campos usados pelo site (TP5): `site_name` (perguntado, com o nome da pasta como sugestão), `date`, `owner`
   * (do `catalog-info.yaml`, senão perguntado) e os declarados no template de site ou nos templates de página.
   */
  private async fieldValues(choice: SiteChoice, used: string[], root: vscode.Uri, pageFields: TemplateField[], given: Record<string, string> = {}) {
    const { template } = choice;
    const values: Record<string, string> = { date: today(), ...given };
    if (values.site_name === undefined) {
      const name = await vscode.window.showInputBox({
        title: template.name,
        prompt: vscode.l10n.t('Name of the site (site_name in mkdocs.yml)'),
        value: decodeURIComponent(root.path.split('/').filter(Boolean).pop() ?? ''),
        validateInput: value => (value.trim() ? undefined : vscode.l10n.t('Type a name')),
      });
      if (!name?.trim()) return undefined;
      values.site_name = name.trim();
    }
    if (used.includes('owner') && values.owner === undefined) {
      const owner = await ownerFromCatalog([root, vscode.workspace.getWorkspaceFolder(root)?.uri]);
      if (owner) values.owner = owner;
    }
    // O campo declarado no template de site vale mais que o de mesmo nome num template de página
    const declared = [...template.fields, ...pageFields];
    const asked = [
      ...(used.includes('owner') && values.owner === undefined
        ? [{ name: 'owner', prompt: vscode.l10n.t('Team or person who owns this documentation'), default: await gitUserName(root) }]
        : []),
      ...declared.filter((f, i) => f.name !== 'owner' && used.includes(f.name) && values[f.name] === undefined && declared.findIndex(d => d.name === f.name) === i),
    ];
    for (const field of asked) {
      const value = await vscode.window.showInputBox({ title: template.name, prompt: field.prompt, value: field.default });
      if (value === undefined) return undefined;
      values[field.name] = value;
    }
    return values;
  }

  /**
   * A anotação do TechDocs que falta (TP11): no `catalog-info.yaml` da pasta do site ou da raiz do workspace;
   * undefined se ele já a tem. O arquivo não é alterado.
   */
  private async catalogAnnotation(root: vscode.Uri): Promise<{ text: string; catalog?: vscode.Uri } | undefined> {
    const workspace = vscode.workspace.getWorkspaceFolder(root)?.uri;
    const relativeTo = (uri: vscode.Uri) => (workspace && uri.path.startsWith(workspace.path) ? uri.path.slice(workspace.path.length).replace(/^\/+/, '') : '');
    for (const dir of [root, workspace]) {
      if (!dir) continue;
      const catalog = vscode.Uri.joinPath(dir, 'catalog-info.yaml');
      const text = await readText(catalog);
      if (text === undefined) continue;
      if (hasTechdocsRef(text)) return undefined;
      return { text: techdocsRefAnnotation(relativeTo(dir), relativeTo(root)), catalog };
    }
    return { text: techdocsRefAnnotation('', '') };
  }

  private async showAnnotation(annotation: { text: string; catalog?: vscode.Uri }, root: vscode.Uri) {
    const copy = vscode.l10n.t('Copy annotation');
    const message = annotation.catalog
      ? vscode.l10n.t(
          'Site created. For TechDocs to publish it, add to metadata.annotations in {0}: {1}',
          relative(annotation.catalog),
          annotation.text,
        )
      : vscode.l10n.t(
          'Site created in {0}. For TechDocs to publish it, add to metadata.annotations in the catalog-info.yaml of the component: {1}',
          relative(root),
          annotation.text,
        );
    if ((await vscode.window.showInformationMessage(message, copy)) === copy) await vscode.env.clipboard.writeText(annotation.text);
  }
}

/** Caminho para as mensagens: relativo ao workspace, ou o nome dele para a raiz. */
function relative(uri: vscode.Uri) {
  const workspace = vscode.workspace.getWorkspaceFolder(uri);
  return workspace && workspace.uri.path === uri.path ? workspace.name : vscode.workspace.asRelativePath(uri);
}
