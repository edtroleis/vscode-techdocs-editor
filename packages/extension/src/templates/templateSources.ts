import * as vscode from 'vscode';
import { catalogOwner, DocTemplate, parseSiteTemplate, parseTemplate, SiteTemplate } from '@edtroleis/techdocs-editor-core';
import { BUILT_IN_SITES, BUILT_IN_TEMPLATES, templateLanguage } from '@edtroleis/techdocs-editor-core/src/builtInTemplates';
import { gitApi } from '../publish/vscodeGit';

/** Template de página da lista: da extensão, ou do repositório ou da empresa (TA3), com a origem (TP2). */
export type PageChoice = { template: DocTemplate; origin: 'builtIn' } | { template: DocTemplate; origin: 'repository' | 'central'; source: string };

/** Template de site: os arquivos vêm do registro da extensão ou da pasta do template no repositório. */
export type SiteChoice =
  | { template: SiteTemplate; origin: 'builtIn'; files: Record<string, string> }
  | { template: SiteTemplate; origin: 'central'; source: string; files: Record<string, string> }
  | { template: SiteTemplate; origin: 'repository'; source: string; folder: vscode.Uri };

export const exists = async (uri: vscode.Uri) => {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
};

export const readText = async (uri: vscode.Uri) => {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
};

export async function fileNames(folder: vscode.Uri): Promise<string[]> {
  try {
    return (await vscode.workspace.fs.readDirectory(folder)).map(([name]) => name);
  } catch {
    return [];
  }
}

const templatesConfig = (scope: vscode.Uri) => vscode.workspace.getConfiguration('techdocsEditor.templates', scope);

/** `techdocsEditor.templates.builtIn`: mostrar os templates da extensão. */
export const builtInEnabled = (scope: vscode.Uri) => templatesConfig(scope).get<boolean>('builtIn', true);

/**
 * Pastas de templates do repositório (TP8), da que vale mais para a que vale menos: o `.techdocs/templates/`
 * da raiz do site (se houver), o do workspace e as pastas de `techdocsEditor.templates.paths`.
 */
export function templateFolders(siteRoot: vscode.Uri | undefined, scope: vscode.Uri): vscode.Uri[] {
  const workspace = vscode.workspace.getWorkspaceFolder(scope)?.uri;
  return [
    ...(siteRoot ? [vscode.Uri.joinPath(siteRoot, '.techdocs', 'templates')] : []),
    ...(workspace ? [vscode.Uri.joinPath(workspace, '.techdocs', 'templates')] : []),
    ...templatesConfig(scope)
      .get<string[]>('paths', [])
      .filter(path => typeof path === 'string' && path.trim())
      .flatMap(path => (path.startsWith('/') ? [scope.with({ path })] : workspace ? [vscode.Uri.joinPath(workspace, path)] : [])),
  ].filter((folder, i, all) => all.findIndex(f => f.toString() === folder.toString()) === i);
}

/** Os `.md` com bloco `template:` das pastas, na ordem delas: o primeiro de cada id vale. */
export async function repositoryPageTemplates(folders: vscode.Uri[]): Promise<PageChoice[]> {
  const found: PageChoice[] = [];
  const ids = new Set<string>();
  for (const folder of folders) {
    const source = vscode.workspace.asRelativePath(folder);
    for (const name of (await fileNames(folder)).filter(n => n.toLowerCase().endsWith('.md')).sort()) {
      const id = name.slice(0, -3);
      if (ids.has(id)) continue;
      const text = await readText(vscode.Uri.joinPath(folder, name));
      const template = text === undefined ? undefined : parseTemplate(id, text);
      if (!template) continue;
      ids.add(id);
      found.push({ template, origin: 'repository', source });
    }
  }
  return found;
}

/** Templates de página da extensão, na língua do VS Code (TP9). */
export const builtInPageTemplates = (): PageChoice[] =>
  Object.entries(BUILT_IN_TEMPLATES[templateLanguage(vscode.env.language)])
    .map(([id, text]) => parseTemplate(id, text))
    .filter((t): t is DocTemplate => Boolean(t))
    .map(template => ({ template, origin: 'builtIn' as const }));

/** As subpastas com `template.yml` das pastas de templates, na ordem delas: o primeiro de cada id vale (TP8). */
export async function repositorySiteTemplates(folders: vscode.Uri[]): Promise<SiteChoice[]> {
  const found: SiteChoice[] = [];
  const ids = new Set<string>();
  for (const base of folders) {
    const source = vscode.workspace.asRelativePath(base);
    for (const id of (await fileNames(base)).sort()) {
      if (ids.has(id)) continue;
      const folder = vscode.Uri.joinPath(base, id);
      const text = await readText(vscode.Uri.joinPath(folder, 'template.yml'));
      const template = text === undefined ? undefined : parseSiteTemplate(id, text);
      if (!template) continue;
      ids.add(id);
      found.push({ template, origin: 'repository', source, folder });
    }
  }
  return found;
}

/** Templates de site da extensão, na língua do VS Code. */
export const builtInSiteTemplates = (): SiteChoice[] =>
  Object.entries(BUILT_IN_SITES[templateLanguage(vscode.env.language)]).flatMap(([id, files]) => {
    const template = parseSiteTemplate(id, files['template.yml']);
    return template ? [{ template, origin: 'builtIn' as const, files }] : [];
  });

/** `spec.owner` do primeiro `catalog-info.yaml` das pastas que tiver (TA1). */
export async function ownerFromCatalog(roots: (vscode.Uri | undefined)[]) {
  for (const root of roots) {
    if (!root) continue;
    const text = await readText(vscode.Uri.joinPath(root, 'catalog-info.yaml'));
    const owner = text && catalogOwner(text);
    if (owner) return owner;
  }
  return undefined;
}

/** `user.name` do Git do repositório, como sugestão para o dono (TA1). */
export async function gitUserName(uri: vscode.Uri): Promise<string> {
  try {
    const repository = (await gitApi())?.getRepository(uri) as { getConfig?(key: string): Promise<string> } | null | undefined;
    return (await repository?.getConfig?.('user.name')) ?? '';
  } catch {
    return '';
  }
}
