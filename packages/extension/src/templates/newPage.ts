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
import { VisualEditorProvider } from '../visualEditorProvider';
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
  ) {}

  async run(target?: vscode.Uri | DocsItem, answers?: NewPageAnswers): Promise<vscode.Uri | undefined> {
    const where = await this.resolveTarget(target);
    if (!where) return undefined;
    const { site, folder, section } = where;
    const docsDir = site.mkdocs.with({ path: site.site.docsDir });

    const choice = await this.pickTemplate(site, answers?.template);
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
    if (template.numbered) fileName = `${nextNumber(await fileNames(baseUri))}-${fileName}`;
    const suggested = base ? `${base}/${fileName}` : fileName;
    const validate = async (value: string) => {
      const path = pagePath('', value.trim());
      if (!path) return vscode.l10n.t('Use a .md file name inside the docs folder');
      if (await exists(vscode.Uri.joinPath(docsDir, path))) return vscode.l10n.t('{0} already exists. Choose another name.', path);
      return undefined;
    };
    const path = answers
      ? (answers.path ?? suggested)
      : await vscode.window.showInputBox({
          title: template.name,
          prompt: vscode.l10n.t('File of the new page, inside {0}', vscode.workspace.asRelativePath(docsDir)),
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

    const values = await this.fieldValues(template, title.trim(), site, answers?.values);
    if (!values) return undefined;
    const page = pagePath('', path.trim())!;
    const nav = await this.navChange(site, page, title.trim(), section, answers);
    if (nav === null) return undefined;
    const uri = vscode.Uri.joinPath(docsDir, page);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    const content = fillTemplate(template.body, values);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    if (nav) await nav();
    await vscode.commands.executeCommand('vscode.openWith', uri, VisualEditorProvider.viewType);
    // TP7: o cursor no primeiro trecho a preencher, selecionado (digitar troca o texto de exemplo)
    const fill = firstToFill(content);
    if (fill && this.provider) (await this.provider.session(uri).catch(() => undefined))?.select(fill);
    return uri;
  }

  /** Site e pasta (relativa ao `docs_dir`) de onde a página vai: o item clicado, a página ativa ou a escolha. */
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
   * das pastas de `techdocsEditor.templates.paths`, nessa ordem (o primeiro de cada id vale), e os da extensão,
   * a não ser com `techdocsEditor.templates.builtIn: false`.
   */
  private async templates(site: Site): Promise<PageChoice[]> {
    const repository = await repositoryPageTemplates(templateFolders(site.mkdocs.with({ path: site.site.root }), site.mkdocs));
    return mergeTemplates<PageChoice>(repository, builtInEnabled(site.mkdocs) ? builtInPageTemplates() : []);
  }

  /**
   * Lista agrupada por categoria (TP2), com os do repositório primeiro e a pasta de onde vieram. Template de
   * uma versão do formato mais nova que a extensão aparece, mas não é usado.
   */
  private async pickTemplate(site: Site, id: string | undefined): Promise<PageChoice | undefined> {
    const choices = await this.templates(site);
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
  private async fieldValues(template: DocTemplate, title: string, site: Site, given: Record<string, string> = {}) {
    const used = usedFields(template.body);
    const values: Record<string, string> = { title, date: today(), ...given };
    if (used.includes('site_name') && values.site_name === undefined) {
      values.site_name = siteName(await readText(site.mkdocs)) ?? '';
    }
    if (used.includes('owner') && values.owner === undefined) {
      const owner = await ownerFromCatalog([site.mkdocs.with({ path: site.site.root }), vscode.workspace.getWorkspaceFolder(site.mkdocs)?.uri]);
      if (owner) values.owner = owner;
    }
    const asked = [
      ...(used.includes('owner') && values.owner === undefined
        ? [{ name: 'owner', prompt: vscode.l10n.t('Team or person who owns this page'), default: await gitUserName(site.mkdocs) }]
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
   * Devolve a gravação a fazer depois de criar a página, undefined se não há o que fazer e null se cancelou.
   * O `mkdocs.yml` é editado pelo documento, que pode ter alterações não salvas.
   */
  private async navChange(site: Site, page: string, title: string, section: string[] | undefined, answers?: NewPageAnswers) {
    const document = await vscode.workspace.openTextDocument(site.mkdocs);
    const insertion = addToNav(document.getText(), page, title, section);
    if (!insertion) return undefined;
    const write = async () => {
      const wasDirty = document.isDirty;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), insertion.yml);
      if ((await vscode.workspace.applyEdit(edit)) && !wasDirty) await document.save();
    };
    if (answers) return answers.nav ? write : undefined;
    const choice = await askNav(insertion.section);
    if (!choice) return null;
    return choice === 'add' ? write : undefined;
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
