import * as vscode from 'vscode';
import { siteName } from '@edtroleis/techdocs-editor-core';
import { isShownSite } from './docsSite';
import { type LocalSites, sitePath } from './localSites';

const SETTING = 'sites';

/** Escolha das pastas para os testes de integração: o que marcar (undefined = cancelar). */
let testChoice: ((items: SiteChoice[]) => SiteChoice[] | undefined) | undefined;
export function useTestSiteChoice(choose: typeof testChoice) {
  testChoice = choose;
}

export type SiteChoice = vscode.QuickPickItem & { path: string; repo: string };

/**
 * "Escolher documentação…" (workspaces com muitos sites): a lista dos sites achados, agrupada pelo repositório
 * Git, com os mostrados marcados. Guarda em `techdocsEditor.sites` do workspace; tudo ou nada marcado = todos.
 */
export async function chooseSites(sites: LocalSites) {
  await sites.ready;
  const chosen = sites.chosen();
  const items: SiteChoice[] = await Promise.all(
    sites.all().map(async ({ mkdocs, site }) => {
      const root = mkdocs.with({ path: site.root });
      const path = sitePath(root);
      return {
        label: siteName(await readText(mkdocs)) ?? site.root.split('/').pop()!,
        description: path,
        path,
        repo: await repoOf(root),
        picked: Boolean(chosen?.length) && isShownSite(path, chosen),
      };
    }),
  );
  items.sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path));
  const picked = testChoice ? testChoice(items) : await pick(items);
  if (!picked) return;
  const all = !picked.length || picked.length === items.length;
  await save(all ? [] : picked.map(item => item.path));
}

/** "Esconder" no menu de um site da árvore: sai da lista escolhida (sem escolha, ficam todos os outros). */
export async function hideSite(sites: LocalSites, root: vscode.Uri | undefined) {
  if (!root) return;
  const path = sitePath(root);
  const shown = sites
    .list()
    .map(({ mkdocs, site }) => sitePath(mkdocs.with({ path: site.root })))
    .filter(p => p !== path);
  // Escondeu o último: ficaria nada; volta a mostrar todos
  await save(shown.length ? shown : []);
}

/** "Não mostrar de novo" no aviso: todos os sites, sem perguntar. */
export function dismissChooseSites() {
  return save([]);
}

function save(paths: string[]) {
  return vscode.workspace.getConfiguration('techdocsEditor').update(SETTING, paths, vscode.ConfigurationTarget.Workspace);
}

function pick(items: SiteChoice[]): Promise<SiteChoice[] | undefined> {
  const quickPick = vscode.window.createQuickPick<SiteChoice>();
  quickPick.title = vscode.l10n.t('Documentation to show in this workspace');
  quickPick.placeholder = vscode.l10n.t('Filter by name or folder');
  quickPick.canSelectMany = true;
  quickPick.matchOnDescription = true;
  const grouped: SiteChoice[] = [];
  for (const item of items) {
    if (grouped.at(-1)?.repo !== item.repo) grouped.push({ label: item.repo, kind: vscode.QuickPickItemKind.Separator, path: '', repo: item.repo });
    grouped.push(item);
  }
  quickPick.items = grouped;
  quickPick.selectedItems = items.filter(item => item.picked);
  return new Promise(resolve => {
    let result: SiteChoice[] | undefined;
    quickPick.onDidAccept(() => {
      result = [...quickPick.selectedItems];
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(result);
    });
    quickPick.show();
  });
}

/** O repositório Git do site (a pasta com `.git` mais próxima, até a do workspace), relativo ao workspace. */
async function repoOf(root: vscode.Uri): Promise<string> {
  const folder = vscode.workspace.getWorkspaceFolder(root);
  let dir = root;
  while (folder && dir.path.length >= folder.uri.path.length) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, '.git'));
      return sitePath(dir);
    } catch {
      dir = vscode.Uri.joinPath(dir, '..');
    }
  }
  return folder?.name ?? '';
}

async function readText(uri: vscode.Uri) {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}
