import * as vscode from 'vscode';
import {
  catalogOwner,
  DocTemplate,
  fileNameFor,
  fillTemplate,
  mergeTemplates,
  nextNumber,
  pagePath,
  parseTemplate,
  siteName,
  TemplateCategory,
  today,
  usedFields,
} from '@edtroleis/techdocs-editor-core';
import { BUILT_IN_TEMPLATES, templateLanguage } from '@edtroleis/techdocs-editor-core/src/builtInTemplates';
import type { DocsSite } from '../docsSite';
import { DocsItem } from '../docsTreeView';
import type { LocalSites } from '../localSites';
import { gitApi } from '../publish/vscodeGit';
import { VisualEditorProvider } from '../visualEditorProvider';

/** Respostas prontas, para os testes de integração (sem as caixas de escolha). */
export type NewPageAnswers = { template: string; title: string; path?: string; values?: Record<string, string> };

type Site = { mkdocs: vscode.Uri; site: DocsSite };
type Choice = { template: DocTemplate; origin: 'builtIn' };

const categoryLabel = (category: TemplateCategory) =>
  ({
    tutorial: vscode.l10n.t('Learn (tutorials)'),
    guide: vscode.l10n.t('Do a task (how-to guides)'),
    reference: vscode.l10n.t('Look up (reference)'),
    explanation: vscode.l10n.t('Understand (explanation)'),
  })[category];

const exists = async (uri: vscode.Uri) => {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
};

const readText = async (uri: vscode.Uri) => {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
};

/**
 * "TechDocs: Nova página a partir de template…" (spec 04, T1): escolhe o template, o título e o
 * arquivo, preenche os campos, grava no `docs_dir` e abre no editor visual.
 */
export class NewPageCommand {
  constructor(private readonly sites: LocalSites) {}

  async run(target?: vscode.Uri | DocsItem, answers?: NewPageAnswers): Promise<vscode.Uri | undefined> {
    const where = await this.resolveTarget(target);
    if (!where) return undefined;
    const { site, folder } = where;
    const docsDir = site.mkdocs.with({ path: site.site.docsDir });

    const choice = await this.pickTemplate(answers?.template);
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
    if (template.numbered) fileName = `${nextNumber(await this.fileNames(baseUri))}-${fileName}`;
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
    const uri = vscode.Uri.joinPath(docsDir, pagePath('', path.trim())!);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(fillTemplate(template.body, values)));
    await vscode.commands.executeCommand('vscode.openWith', uri, VisualEditorProvider.viewType);
    return uri;
  }

  /** Site e pasta (relativa ao `docs_dir`) de onde a página vai: o item clicado, a página ativa ou a escolha. */
  private async resolveTarget(target?: vscode.Uri | DocsItem): Promise<{ site: Site; folder: string } | undefined> {
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
      return { site: inSite, folder };
    }
    if (sites.length === 1) return { site: sites[0], folder: '' };
    const picked = await vscode.window.showQuickPick(
      sites.map(s => ({ label: vscode.workspace.asRelativePath(s.mkdocs), site: s })),
      { title: vscode.l10n.t('Which documentation site?') },
    );
    return picked && { site: picked.site, folder: '' };
  }

  private templates(): Choice[] {
    const language = templateLanguage(vscode.env.language);
    const builtIn = Object.entries(BUILT_IN_TEMPLATES[language])
      .map(([id, text]) => parseTemplate(id, text))
      .filter((t): t is DocTemplate => Boolean(t))
      .map(template => ({ template, origin: 'builtIn' as const }));
    return mergeTemplates<Choice>([], builtIn);
  }

  /** Lista agrupada por categoria (TP2). */
  private async pickTemplate(id: string | undefined): Promise<Choice | undefined> {
    const choices = this.templates();
    if (id) return choices.find(c => c.template.id === id);
    type Item = vscode.QuickPickItem & { choice?: Choice };
    const items: Item[] = [];
    let category: TemplateCategory | undefined;
    for (const choice of choices) {
      if (choice.template.category !== category) {
        category = choice.template.category;
        items.push({ label: categoryLabel(category), kind: vscode.QuickPickItemKind.Separator });
      }
      items.push({ label: choice.template.name, detail: choice.template.description, choice });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t('New page from template'),
      placeHolder: vscode.l10n.t('Choose the kind of page'),
      matchOnDetail: true,
    });
    return picked?.choice;
  }

  /** Campos usados na página: os automáticos (TP5) e os do template, perguntados um a um. */
  private async fieldValues(template: DocTemplate, title: string, site: Site, given: Record<string, string> = {}) {
    const used = usedFields(template.body);
    const values: Record<string, string> = { title, date: today(), ...given };
    if (used.includes('site_name') && values.site_name === undefined) {
      values.site_name = siteName(await readText(site.mkdocs)) ?? '';
    }
    if (used.includes('owner') && values.owner === undefined) {
      const owner = await this.catalogOwner(site);
      if (owner) values.owner = owner;
    }
    const asked = [
      ...(used.includes('owner') && values.owner === undefined
        ? [{ name: 'owner', prompt: vscode.l10n.t('Team or person who owns this page'), default: await gitUserName(site) }]
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

  /** `spec.owner` do `catalog-info.yaml` da raiz do site ou do workspace (TA1). */
  private async catalogOwner(site: Site) {
    const roots = [site.mkdocs.with({ path: site.site.root }), vscode.workspace.getWorkspaceFolder(site.mkdocs)?.uri];
    for (const root of roots) {
      if (!root) continue;
      const text = await readText(vscode.Uri.joinPath(root, 'catalog-info.yaml'));
      const owner = text && catalogOwner(text);
      if (owner) return owner;
    }
    return undefined;
  }

  private async fileNames(folder: vscode.Uri): Promise<string[]> {
    try {
      return (await vscode.workspace.fs.readDirectory(folder)).map(([name]) => name);
    } catch {
      return [];
    }
  }
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

/** `user.name` do Git do repositório do site, como sugestão para o dono (TA1). */
async function gitUserName(site: Site): Promise<string> {
  try {
    const repository = (await gitApi())?.getRepository(site.mkdocs) as { getConfig?(key: string): Promise<string> } | null | undefined;
    return (await repository?.getConfig?.('user.name')) ?? '';
  } catch {
    return '';
  }
}
