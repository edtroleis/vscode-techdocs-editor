import * as vscode from 'vscode';
import {
  addToNav,
  branchFor,
  createRemotePage,
  DocTemplate,
  fileNameFor,
  fillTemplate,
  firstToFill,
  isTemplateSupported,
  mergeTemplates,
  nextNumber,
  pagePath,
  parseRemoteUri,
  REMOTE_SCHEME,
  RemotePageExistsError,
  RemoteSite,
  siteName,
  TemplateCategory,
  today,
  usedFields,
} from '@edtroleis/techdocs-editor-core';
import type { DocsSite } from '../docsSite';
import { DocsItem } from '../docsTreeView';
import type { LocalSites } from '../localSites';
import { gitHubErrorText } from '../publish/githubAuth';
import { publishConfig } from '../publish/publishConfig';
import { remoteUri } from '../remote/remoteFs';
import type { RemoteRepos, RepoAccess } from '../remote/remoteRepos';
import { VisualEditorProvider } from '../visualEditorProvider';
import type { CentralTemplates } from './centralTemplates';
import {
  builtInEnabled,
  builtInPageTemplates,
  exists,
  fileNames,
  gitUserName,
  ownerFromCatalog,
  PageChoice,
  readText,
  repositoryPageTemplates,
  templateFolders,
} from './templateSources';

/** Respostas prontas, para os testes de integração (sem as caixas de escolha). */
export type NewPageAnswers = { template: string; title: string; path?: string; values?: Record<string, string>; nav?: boolean };

type Site = { mkdocs: vscode.Uri; site: DocsSite };

/**
 * Onde a página nova vai: um site do workspace (o arquivo gravado no disco) ou um site do GitHub (TP10: um
 * commit na branch do rascunho da página nova). O resto do fluxo (template, título, arquivo, campos, `nav`) é
 * o mesmo.
 */
type Destination = {
  /** O `docs_dir` (as páginas são relativas a ele). */
  docsDir: vscode.Uri;
  /** Pasta (relativa ao `docs_dir`) de onde a página vai, e a seção do `nav` clicada na árvore. */
  folder: string;
  section?: string[];
  /** Como mostrar o `docs_dir` na pergunta do arquivo. */
  where: string;
  /** Escopo das configurações (`templates.*`) e da empresa (TA3). */
  scope: vscode.Uri;
  templateFolders: vscode.Uri[];
  exists(page: string): Promise<boolean>;
  siteName(): Promise<string | undefined>;
  owner(): Promise<string | undefined>;
  defaultOwner(): Promise<string>;
  /** O `mkdocs.yml` de agora (para o TP6). */
  mkdocs(): Promise<string | undefined>;
  /** Grava a página e, com `nav`, o `mkdocs.yml` novo. Devolve o endereço da página, ou undefined se falhou. */
  create(page: string, content: string, nav: string | undefined, title: string): Promise<vscode.Uri | undefined>;
};

const categoryLabel = (category: TemplateCategory) =>
  ({
    tutorial: vscode.l10n.t('Learn (tutorials)'),
    guide: vscode.l10n.t('Do a task (how-to guides)'),
    reference: vscode.l10n.t('Look up (reference)'),
    explanation: vscode.l10n.t('Understand (explanation)'),
  })[category];

/**
 * "TechDocs: Nova página a partir de template…" (spec 04, T1): escolhe o template, o título e o
 * arquivo, preenche os campos, grava no `docs_dir` e abre no editor visual.
 */
export class NewPageCommand {
  constructor(
    private readonly sites: LocalSites,
    private readonly provider?: VisualEditorProvider,
    private readonly central?: CentralTemplates,
    private readonly remotes?: RemoteRepos,
  ) {}

  async run(target?: vscode.Uri | DocsItem, answers?: NewPageAnswers): Promise<vscode.Uri | undefined> {
    const destination = isRemoteTarget(target) ? await this.remoteDestination(target) : await this.localDestination(target);
    if (!destination) return undefined;
    const { docsDir, folder, section } = destination;

    const choice = await this.pickTemplate(destination, answers?.template);
    if (!choice) return undefined;
    const { template } = choice;

    const title =
      answers?.title ??
      (await vscode.window.showInputBox({
        title: template.name,
        prompt: vscode.l10n.t('Title of the new page'),
        validateInput: value => (value.trim() ? undefined : vscode.l10n.t('Type a title')),
      }));
    if (!title?.trim()) return undefined;

    // Pasta clicada (fora da raiz das docs) vale mais que a sugerida pelo template
    const base = folder || template.folder || '';
    const baseUri = base ? vscode.Uri.joinPath(docsDir, base) : docsDir;
    let fileName = fileNameFor(title);
    if (template.numbered) fileName = `${nextNumber(await fileNames(baseUri).catch(() => []))}-${fileName}`;
    const suggested = base ? `${base}/${fileName}` : fileName;
    const validate = async (value: string) => {
      const path = pagePath('', value.trim());
      if (!path) return vscode.l10n.t('Use a .md file name inside the docs folder');
      if (await destination.exists(path)) return vscode.l10n.t('{0} already exists. Choose another name.', path);
      return undefined;
    };
    const path = answers
      ? (answers.path ?? suggested)
      : await vscode.window.showInputBox({
          title: template.name,
          prompt: vscode.l10n.t('File of the new page, inside {0}', destination.where),
          value: suggested,
          valueSelection: [suggested.length - fileName.length, suggested.length - 3],
          validateInput: validate,
        });
    if (!path) return undefined;
    // TP4: nunca sobrescreve e nunca sai do docs_dir (também com as respostas dos testes)
    const problem = await validate(path);
    if (problem) {
      void vscode.window.showErrorMessage(problem);
      return undefined;
    }

    const values = await this.fieldValues(template, title.trim(), destination, answers?.values);
    if (!values) return undefined;
    const page = pagePath('', path.trim())!;
    const nav = await this.navChange(destination, page, title.trim(), section, answers);
    if (nav === null) return undefined;
    const content = fillTemplate(template.body, values);
    const uri = await destination.create(page, content, nav, title.trim());
    if (!uri) return undefined;
    await vscode.commands.executeCommand('vscode.openWith', uri, VisualEditorProvider.viewType);
    // TP7: o cursor no primeiro trecho a preencher, selecionado (digitar troca o texto de exemplo)
    const fill = firstToFill(content);
    if (fill && this.provider) (await this.provider.session(uri).catch(() => undefined))?.select(fill);
    return uri;
  }

  /** Site do workspace e pasta (relativa ao `docs_dir`) de onde a página vai: o item clicado, a página ativa ou a escolha. */
  private async localDestination(target?: vscode.Uri | DocsItem): Promise<Destination | undefined> {
    const where = await this.resolveTarget(target);
    if (!where) return undefined;
    const { site } = where;
    const docsDir = site.mkdocs.with({ path: site.site.docsDir });
    const root = site.mkdocs.with({ path: site.site.root });
    let mkdocsDocument: vscode.TextDocument | undefined;
    return {
      docsDir,
      folder: where.folder,
      section: where.section,
      where: vscode.workspace.asRelativePath(docsDir),
      scope: site.mkdocs,
      templateFolders: templateFolders(root, site.mkdocs),
      exists: page => exists(vscode.Uri.joinPath(docsDir, page)),
      siteName: async () => siteName(await readText(site.mkdocs)),
      owner: () => ownerFromCatalog([root, vscode.workspace.getWorkspaceFolder(site.mkdocs)?.uri]),
      defaultOwner: () => gitUserName(site.mkdocs),
      // O `mkdocs.yml` é editado pelo documento, que pode ter alterações não salvas
      mkdocs: async () => (mkdocsDocument = await vscode.workspace.openTextDocument(site.mkdocs)).getText(),
      create: async (page, content, nav) => {
        const uri = vscode.Uri.joinPath(docsDir, page);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
        const document = mkdocsDocument;
        if (nav !== undefined && document) {
          const wasDirty = document.isDirty;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), nav);
          if ((await vscode.workspace.applyEdit(edit)) && !wasDirty) await document.save();
        }
        return uri;
      },
    };
  }

  /**
   * Site do GitHub (TP10): o da página do GitHub ativa ou do item clicado na árvore. A página nova vai num commit na
   * branch do rascunho dela (D4-3), com o `mkdocs.yml` junto se ela entra no `nav`; a principal não muda.
   */
  private async remoteDestination(target: vscode.Uri | DocsItem | undefined): Promise<Destination | undefined> {
    const uri = target instanceof DocsItem ? remoteItemUri(target) : (target ?? activeRemotePage());
    const ref = uri && parseRemoteUri(uri.authority, uri.path);
    if (!ref || !this.remotes) return undefined;
    let access: RepoAccess;
    try {
      access = await this.remotes.access(ref.host, ref.slug, { signIn: true });
    } catch (error) {
      void vscode.window.showErrorMessage(gitHubErrorText(error, vscode.l10n));
      return undefined;
    }
    if (!access.login || !access.repo.canWrite) {
      void vscode.window.showWarningMessage(vscode.l10n.t('You need write access to {0} to create pages in it.', ref.slug));
      return undefined;
    }
    const entryRoot = target instanceof DocsItem ? rootItem(target).remote?.root : undefined;
    const site = remoteSiteOf(access.sites, ref.path, entryRoot);
    if (!site) {
      void vscode.window.showWarningMessage(vscode.l10n.t('There is no documentation site (mkdocs.yml) for {0} in {1}.', ref.path || '/', ref.slug));
      return undefined;
    }
    const at = (path: string) => remoteUri(ref.host, ref.slug, path);
    const inDocs = (path: string) => (site.docsDir ? `${site.docsDir}/${path}` : path);
    // Pasta clicada (ou da página ativa) dentro do docs_dir
    const isFolder = target instanceof DocsItem && (target.kind === 'remote' || target.kind === 'section');
    const folderPath = isFolder && target.kind === 'remote' ? site.docsDir : isFolder ? ref.path : ref.path.replace(/\/?[^/]*$/, '');
    const folder = folderPath.startsWith(`${site.docsDir}/`) ? folderPath.slice(site.docsDir.length + 1) : '';
    const mkdocsPath = site.root ? `${site.root}/mkdocs.yml` : 'mkdocs.yml';
    const mkdocs = access.files.some(f => f.path === mkdocsPath) ? mkdocsPath : mkdocsPath.replace(/yml$/, 'yaml');
    return {
      docsDir: at(site.docsDir),
      folder,
      section: target instanceof DocsItem ? navSection(target) : undefined,
      where: `${ref.slug}/${site.docsDir}`,
      scope: vscode.workspace.workspaceFolders?.[0]?.uri ?? at(site.root),
      templateFolders: [at(site.root ? `${site.root}/.techdocs/templates` : '.techdocs/templates'), at('.techdocs/templates')].filter(
        (folder, i, all) => all.findIndex(f => f.toString() === folder.toString()) === i,
      ),
      // Na principal; o rascunho de mesmo nome é conferido ao gravar (RemotePageExistsError)
      exists: async page => access.files.some(f => f.path === inDocs(page)),
      siteName: async () => site.name,
      owner: () => ownerFromCatalog([at(site.root), at('')]),
      defaultOwner: async () => access.login!,
      mkdocs: async () => site.yml,
      create: async (page, content, nav, title) => {
        const filePath = inDocs(page);
        const config = publishConfig(vscode.workspace.getConfiguration('techdocsEditor'), undefined, vscode.env.language);
        try {
          const [mainSha, hasWorkflows] = await Promise.all([
            access.client.getBranchSha(access.repo.defaultBranch),
            access.client.hasWorkflows().catch(() => true),
          ]);
          await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Creating {0} on GitHub…', filePath) }, () =>
            createRemotePage(access.client, {
              branch: branchFor(access.login!, filePath, config.branchPattern),
              mainSha: mainSha!,
              filePath,
              files: { [filePath]: content, ...(nav !== undefined ? { [mkdocs]: nav } : {}) },
              message: vscode.l10n.t('docs: new page "{0}"', title),
              skipCi: config.skipCi && hasWorkflows,
            }),
          );
        } catch (error) {
          void vscode.window.showErrorMessage(
            error instanceof RemotePageExistsError
              ? vscode.l10n.t('{0} already exists. Choose another name.', page)
              : gitHubErrorText(error, vscode.l10n),
          );
          return undefined;
        }
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Page created in your draft. Use the Publishing panel to check it and send it for publication.'),
        );
        return at(filePath);
      },
    };
  }

  private async resolveTarget(target?: vscode.Uri | DocsItem): Promise<{ site: Site; folder: string; section?: string[] } | undefined> {
    // Logo depois da ativação, a busca pelos mkdocs.yml ainda pode estar em andamento
    await this.sites.ready;
    const sites = this.sites.list();
    if (!sites.length) {
      void vscode.window.showWarningMessage(vscode.l10n.t('There is no mkdocs.yml in the workspace. Create a documentation site first.'));
      return undefined;
    }
    let uri: vscode.Uri | undefined;
    let isFolder = false;
    if (target instanceof DocsItem) {
      if (target.kind === 'site') {
        uri = target.uri;
        isFolder = true;
      } else {
        uri = firstPage(target)?.uri;
      }
    } else if (target) {
      uri = target;
      isFolder = (await vscode.workspace.fs.stat(target).then(s => s.type, () => 0)) === vscode.FileType.Directory;
    } else {
      uri = vscode.window.activeTextEditor?.document.uri ?? activeCustomEditorUri();
    }
    const folderPath = uri ? (isFolder ? uri.path : uri.path.replace(/\/[^/]*$/, '')) : undefined;
    const inSite = folderPath
      ? sites
          .filter(s => folderPath === s.site.docsDir || folderPath.startsWith(`${s.site.docsDir}/`) || folderPath === s.site.root)
          .sort((a, b) => b.site.docsDir.length - a.site.docsDir.length)[0]
      : undefined;
    if (inSite) {
      const folder = folderPath!.startsWith(`${inSite.site.docsDir}/`) ? folderPath!.slice(inSite.site.docsDir.length + 1) : '';
      return { site: inSite, folder, section: target instanceof DocsItem ? navSection(target) : undefined };
    }
    if (sites.length === 1) return { site: sites[0], folder: '' };
    const picked = await vscode.window.showQuickPick(
      sites.map(s => ({ label: vscode.workspace.asRelativePath(s.mkdocs), site: s })),
      { title: vscode.l10n.t('Which documentation site?') },
    );
    return picked && { site: picked.site, folder: '' };
  }

  /**
   * Templates da lista (TP8): os `.md` com bloco `template:` do `.techdocs/templates/` do site, do workspace e
   * das pastas de `techdocsEditor.templates.paths`, nessa ordem (o primeiro de cada id vale), depois os da empresa
   * (TA3) e os da extensão, a não ser com `techdocsEditor.templates.builtIn: false`.
   */
  private async templates(destination: Destination): Promise<PageChoice[]> {
    const repository = await repositoryPageTemplates(destination.templateFolders);
    const company = await this.central?.get(destination.scope);
    const central = (company?.pages ?? []).map(template => ({ template, origin: 'central' as const, source: company!.label }));
    return mergeTemplates<PageChoice>(repository, central, builtInEnabled(destination.scope) ? builtInPageTemplates() : []);
  }

  /**
   * Lista agrupada por categoria (TP2), com os do repositório primeiro e a pasta de onde vieram. Template de
   * uma versão do formato mais nova que a extensão aparece, mas não é usado.
   */
  private async pickTemplate(destination: Destination, id: string | undefined): Promise<PageChoice | undefined> {
    const choices = await this.templates(destination);
    if (!choices.length) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t('There are no page templates: the built-in ones are turned off and the repository has none.'),
      );
      return undefined;
    }
    let choice: PageChoice | undefined;
    if (id) {
      choice = choices.find(c => c.template.id === id);
    } else {
      type Item = vscode.QuickPickItem & { choice?: PageChoice };
      const items: Item[] = [];
      let group: string | undefined;
      for (const c of choices) {
        const label =
          c.origin === 'repository'
            ? vscode.l10n.t('{0} · this repository', categoryLabel(c.template.category))
            : c.origin === 'central'
              ? vscode.l10n.t('{0} · company', categoryLabel(c.template.category))
              : categoryLabel(c.template.category);
        if (label !== group) {
          group = label;
          items.push({ label, kind: vscode.QuickPickItemKind.Separator });
        }
        const supported = isTemplateSupported(c.template);
        items.push({
          label: c.template.name,
          description: supported
            ? c.origin === 'repository'
              ? `$(repo) ${c.source}`
              : c.origin === 'central'
                ? `$(organization) ${c.source}`
                : undefined
            : vscode.l10n.t('needs a newer version of the extension'),
          detail: c.template.description,
          choice: c,
        });
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: vscode.l10n.t('New page from template'),
        placeHolder: vscode.l10n.t('Choose the kind of page'),
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

  /** Campos usados na página: os automáticos (TP5) e os do template, perguntados um a um. */
  private async fieldValues(template: DocTemplate, title: string, destination: Destination, given: Record<string, string> = {}) {
    const used = usedFields(template.body);
    const values: Record<string, string> = { title, date: today(), ...given };
    if (used.includes('site_name') && values.site_name === undefined) {
      values.site_name = (await destination.siteName()) ?? '';
    }
    if (used.includes('owner') && values.owner === undefined) {
      const owner = await destination.owner();
      if (owner) values.owner = owner;
    }
    const asked = [
      ...(used.includes('owner') && values.owner === undefined
        ? [{ name: 'owner', prompt: vscode.l10n.t('Team or person who owns this page'), default: await destination.defaultOwner() }]
        : []),
      ...template.fields.filter(f => f.name !== 'owner' && used.includes(f.name) && values[f.name] === undefined),
    ];
    for (const field of asked) {
      const value = await vscode.window.showInputBox({ title: template.name, prompt: field.prompt, value: field.default });
      if (value === undefined) return undefined;
      values[field.name] = value;
    }
    return values;
  }

  /**
   * TP6: com `nav`, oferece pôr a página nele (na seção da árvore, na das páginas da mesma pasta ou no fim).
   * Devolve o `mkdocs.yml` novo, undefined se a página fica fora do `nav` e null se cancelou.
   */
  private async navChange(destination: Destination, page: string, title: string, section: string[] | undefined, answers?: NewPageAnswers) {
    const yml = await destination.mkdocs();
    const insertion = yml === undefined ? undefined : addToNav(yml, page, title, section);
    if (!insertion) return undefined;
    if (answers) return answers.nav ? insertion.yml : undefined;
    const choice = await askNav(insertion.section);
    if (!choice) return null;
    return choice === 'add' ? insertion.yml : undefined;
  }
}

/** Seção do `nav` de um item da árvore (títulos desde a raiz): a própria seção ou a da página. */
function navSection(item: DocsItem): string[] | undefined {
  if (item.kind === 'site' || item.kind === 'notInNav' || item.parent?.kind === 'notInNav') return undefined;
  const trail: string[] = [];
  for (let at: DocsItem | undefined = item.kind === 'section' ? item : item.parent; at?.kind === 'section'; at = at.parent) {
    trail.unshift(at.label);
  }
  return trail;
}

/** Pergunta se a página entra no `nav` (TP6); undefined se cancelou. */
async function askNav(section: string[]): Promise<'add' | 'skip' | undefined> {
  const where = section.length ? vscode.l10n.t('in the section {0}', section.join(' › ')) : vscode.l10n.t('at the end');
  const picked = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('Add to the nav'), description: where, value: 'add' as const },
      { label: vscode.l10n.t('Do not add'), description: vscode.l10n.t('the page stays out of the site menu'), value: 'skip' as const },
    ],
    { title: vscode.l10n.t('Site menu (nav in mkdocs.yml)') },
  );
  return picked?.value;
}

/** Primeira página de um item da árvore (a pasta da seção é a pasta dela). */
function firstPage(item: DocsItem): DocsItem | undefined {
  if (item.kind === 'page') return item;
  for (const child of item.children) {
    const page = firstPage(child);
    if (page) return page;
  }
  return undefined;
}

/** O clique ou a página ativa é de um site do GitHub. */
function isRemoteTarget(target: vscode.Uri | DocsItem | undefined): boolean {
  if (target instanceof DocsItem) return Boolean(rootItem(target).remote);
  if (target) return target.scheme === REMOTE_SCHEME;
  return Boolean(activeRemotePage());
}

function rootItem(item: DocsItem): DocsItem {
  let at = item;
  while (at.parent) at = at.parent;
  return at;
}

/** Endereço `techdocs:` do item: o do site, o da página, ou o da primeira página da seção. */
function remoteItemUri(item: DocsItem): vscode.Uri | undefined {
  if (item.kind === 'remote' || item.kind === 'page') return item.uri;
  const page = firstPage(item)?.uri;
  return page && page.with({ path: page.path.replace(/\/[^/]*$/, '') });
}

/** O site do caminho (o de `root`, se veio da árvore; senão o do `docs_dir` mais fundo que contém o caminho). */
function remoteSiteOf(sites: RemoteSite[], path: string, root?: string): RemoteSite | undefined {
  if (root !== undefined) return sites.find(s => s.root === root);
  return sites
    .filter(s => !s.docsDir || path === s.docsDir || path.startsWith(`${s.docsDir}/`) || path === s.root)
    .sort((a, b) => b.docsDir.length - a.docsDir.length)[0];
}

/** Página do GitHub ativa: no editor de texto ou no visual. */
function activeRemotePage(): vscode.Uri | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri ?? activeCustomEditorUri();
  return uri?.scheme === REMOTE_SCHEME ? uri : undefined;
}

function activeCustomEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}
