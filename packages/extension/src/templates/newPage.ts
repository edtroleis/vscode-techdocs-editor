import * as vscode from 'vscode';
import {
  addToNav,
  DocTemplate,
  fileNameFor,
  fillTemplate,
  firstToFill,
  isTemplateSupported,
  mergeTemplates,
  nextNumber,
  pagePath,
  siteName,
  TemplateCategory,
  today,
  usedFields,
} from '@edtroleis/techdocs-editor-core';
import type { DocsSite } from '../docsSite';
import { DocsItem } from '../docsTreeView';
import type { LocalSites } from '../localSites';
import type { PageKindsView } from '../protocol';
import { VisualEditorProvider } from '../visualEditorProvider';
import { centralPageChoices, type CentralTemplates } from './centralTemplates';
import { hasExample, openTemplateExample } from './templateExamples';
import {
  builtInEnabled,
  builtInPageTemplates,
  siteTemplateLanguage,
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

const BLANK_ID = 'blank';

/** Só o título: para escrever do zero ou colar o conteúdo de outra ferramenta. */
const blankTemplate = (): DocTemplate => ({
  id: BLANK_ID,
  name: vscode.l10n.t('Blank page'),
  description: vscode.l10n.t('Just the title, to write or paste the content'),
  category: 'reference',
  numbered: false,
  version: 1,
  fields: [],
  body: '# {{title}}\n',
});

/**
 * "TechDocs: Nova página a partir de template…" (spec 04, T1): escolhe o template, o título e o
 * arquivo, preenche os campos, grava no `docs_dir` e abre no editor visual.
 */
export class NewPageCommand {
  constructor(
    private readonly sites: LocalSites,
    private readonly provider?: VisualEditorProvider,
    private readonly central?: CentralTemplates,
  ) {}

  async run(target?: vscode.Uri | DocsItem, answers?: NewPageAnswers): Promise<vscode.Uri | undefined> {
    const destination = await this.localDestination(target);
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

  /** Os tipos de página do site da página `uri` (spec: o botão TechDocs e o "/" do editor visual). */
  async kinds(uri: vscode.Uri): Promise<PageKindsView | undefined> {
    const destination = await this.localDestination(uri, true);
    if (!destination) return undefined;
    const choices = (await this.templates(destination)).filter(c => isTemplateSupported(c.template));
    if (!choices.length) return undefined;
    return {
      group: vscode.l10n.t('Kinds of page'),
      components: vscode.l10n.t('TechDocs components'),
      kinds: choices.map(c => ({ id: c.template.id, label: c.template.name, description: c.template.description })),
    };
  }

  /**
   * O texto de um tipo de página para entrar na página aberta: sem o front matter e sem o título (a página já tem
   * o dela), com os campos preenchidos sem perguntar (o dono do catalog-info.yaml ou o nome do Git; os outros com o
   * valor padrão do template ou, sem ele, o texto da pergunta, como exemplo para trocar). `select`: o primeiro trecho a preencher (TP7).
   */
  async kindText(uri: vscode.Uri, id: string, title: string): Promise<{ markdown: string; select?: string } | undefined> {
    const destination = await this.localDestination(uri, true);
    if (!destination) return undefined;
    const choice = (await this.templates(destination)).find(c => c.template.id === id);
    if (!choice) return undefined;
    const { template } = choice;
    const used = usedFields(template.body);
    const values: Record<string, string> = { title, date: today() };
    if (used.includes('site_name')) values.site_name = (await destination.siteName()) ?? '';
    // Sem perguntar: o que não se sabe vem com o texto da pergunta, como exemplo para trocar
    if (used.includes('owner')) values.owner = (await destination.owner()) || (await destination.defaultOwner()) || vscode.l10n.t('Team or person who owns this page');
    for (const field of template.fields) if (values[field.name] === undefined) values[field.name] = field.default || field.prompt;
    const content = fillTemplate(template.body, values)
      .replace(/^---\n[\s\S]*?\n---\n+/, '')
      .replace(/^#\s+.*\n+/, '');
    return { markdown: content, select: firstToFill(content) };
  }

  /** Site do workspace e pasta (relativa ao `docs_dir`) de onde a página vai: o item clicado, a página ativa ou a escolha. */
  private async localDestination(target?: vscode.Uri | DocsItem, quiet = false): Promise<Destination | undefined> {
    const where = await this.resolveTarget(target, quiet);
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

  private async resolveTarget(target?: vscode.Uri | DocsItem, quiet = false): Promise<{ site: Site; folder: string; section?: string[] } | undefined> {
    // Logo depois da ativação, a busca pelos mkdocs.yml ainda pode estar em andamento
    await this.sites.ready;
    const sites = this.sites.list();
    if (!sites.length) {
      if (quiet) return undefined;
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
    if (quiet) return undefined;
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
    const language = await siteTemplateLanguage(await destination.mkdocs(), [destination.docsDir]);
    const company = await this.central?.get(destination.scope, false, language);
    const central = centralPageChoices(company);
    const builtIn = builtInEnabled(destination.scope) ? builtInPageTemplates(language) : [];
    return mergeTemplates<PageChoice>(repository, central, builtIn);
  }

  /**
   * Lista agrupada por categoria (TP2), com os do repositório primeiro e a pasta de onde vieram. Template de
   * uma versão do formato mais nova que a extensão aparece, mas não é usado.
   */
  private async pickTemplate(destination: Destination, id: string | undefined): Promise<PageChoice | undefined> {
    const choices = await this.templates(destination);
    // Página em branco: sempre no topo, também com os templates da extensão desligados (para colar conteúdo)
    const blank: PageChoice = { template: blankTemplate(), origin: 'builtIn' };
    let choice: PageChoice | undefined;
    if (id) {
      choice = choices.find(c => c.template.id === id) ?? (id === BLANK_ID ? blank : undefined);
    } else {
      type Item = vscode.QuickPickItem & { choice?: PageChoice };
      const items: Item[] = [{ label: blank.template.name, detail: blank.template.description, choice: blank }];
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
          ...(supported && hasExample(c) && { buttons: [exampleButton] }),
        });
      }
      choice = await pickWithExamples(items, destination.scope);
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
    const insertion = yml === undefined ? undefined : addToNav(yml, page, section);
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

function activeCustomEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

const exampleButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('eye'), tooltip: vscode.l10n.t('See an example') };

/**
 * A lista de templates com o botão "Ver exemplo" (spec 08, TR4). O exemplo abre ao lado e a lista continua aberta
 * (não some ao perder o foco), para escolher depois de ver.
 */
function pickWithExamples(items: (vscode.QuickPickItem & { choice?: PageChoice })[], scope?: vscode.Uri): Promise<PageChoice | undefined> {
  const quickPick = vscode.window.createQuickPick<(typeof items)[number]>();
  quickPick.title = vscode.l10n.t('New page from template');
  quickPick.placeholder = vscode.l10n.t('Choose the kind of page');
  quickPick.matchOnDetail = true;
  quickPick.ignoreFocusOut = true;
  quickPick.items = items;
  const optionsButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('gear'), tooltip: vscode.l10n.t('Template options') };
  quickPick.buttons = [optionsButton];
  return new Promise(resolve => {
    let picked: PageChoice | undefined;
    quickPick.onDidTriggerButton(() => {
      quickPick.hide();
      // As opções do repositório da página nova (numa workspace com várias pastas, não a primeira)
      void vscode.commands.executeCommand('techdocsEditor.templateOptions', scope);
    });
    quickPick.onDidTriggerItemButton(event => event.item.choice && void openTemplateExample(event.item.choice));
    quickPick.onDidAccept(() => {
      picked = quickPick.selectedItems[0]?.choice;
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(picked);
    });
    quickPick.show();
  });
}
