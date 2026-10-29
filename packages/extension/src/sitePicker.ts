import * as vscode from 'vscode';
import { pageTitle } from '@edtroleis/techdocs-editor-core';
import { hideSite } from './chooseSites';
import type { SiteCandidate } from './docsTreeView';
import type { LocalSites } from './localSites';
import type { RemoteRepos } from './remote/remoteRepos';

/** Quantos sites recentes a lista mostra ao abrir. */
export const RECENT_COUNT = 5;
/** Até onde procurar pastas sem documentação, a partir da pasta do workspace. */
const FOLDER_DEPTH = 3;
const MAX_PAGES = 3000;
const SKIPPED = new Set(['node_modules', 'site', 'out', 'dist', 'build', 'target', 'vendor']);

/** O que a lista precisa da árvore. */
export type PickerHost = {
  candidates: readonly SiteCandidate[];
  currentKey: string | undefined;
  /** Chaves dos últimos sites mostrados, o mais recente primeiro. */
  recents: readonly string[];
  select(key: string): Promise<void>;
  /** Rascunhos da pessoa por site (de "Minhas alterações"). */
  drafts(): Map<string, { draft: number; review: number }>;
  sites: LocalSites;
  remotes: RemoteRepos;
};

type Item = vscode.QuickPickItem & {
  site?: SiteCandidate;
  page?: { uri: vscode.Uri; remote: boolean };
  folder?: vscode.Uri;
  action?: 'all' | 'recent' | 'create' | 'undo';
};

/** Páginas lidas de cada site local (título e arquivo), até a árvore mudar. */
let pageCache = new Map<string, Promise<Array<{ title: string; uri: vscode.Uri }>>>();
export function invalidatePages() {
  pageCache = new Map();
}

/**
 * "Trocar documentação": ao abrir, os sites recentes, "Ver todos os sites" e "Criar documentação numa pasta…".
 * Ao digitar, a busca vale para todos os sites, as páginas deles e as pastas do workspace sem documentação. Cada
 * site mostra o nome (a pasta fica no botão de pasta, com o caminho na dica), os rascunhos da pessoa e o × para
 * esconder; as outras ações ficam nos botões do título.
 */
export async function pickSite(host: PickerHost) {
  const quickPick = vscode.window.createQuickPick<Item>();
  quickPick.title = vscode.l10n.t('Documentation to edit');
  quickPick.placeholder = vscode.l10n.t('Search sites, pages and folders');
  quickPick.matchOnDescription = true;
  const titleButtons = {
    create: { iconPath: new vscode.ThemeIcon('new-folder'), tooltip: vscode.l10n.t('Create documentation in a folder…') },
    github: { iconPath: new vscode.ThemeIcon('github'), tooltip: vscode.l10n.t('Open from GitHub by link…') },
    folder: { iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: vscode.l10n.t('Open another folder…') },
    choose: { iconPath: new vscode.ThemeIcon('list-filter'), tooltip: vscode.l10n.t('Choose which sites of this workspace appear…') },
  };
  quickPick.buttons = [titleButtons.create, titleButtons.github, titleButtons.folder, ...(host.sites.all().length > 1 ? [titleButtons.choose] : [])];
  const folderButton = (tooltip: string) => ({ iconPath: new vscode.ThemeIcon('folder'), tooltip });
  const hideButton = { iconPath: new vscode.ThemeIcon('close'), tooltip: vscode.l10n.t('Hide from this list') };

  let candidates = [...host.candidates];
  let mode: 'recent' | 'all' = 'recent';
  let pages: Array<{ title: string; uri: vscode.Uri; site: SiteCandidate }> = [];
  let empty: vscode.Uri[] | undefined;
  /** O último site escondido pelo ×, para desfazer. */
  let undo: { site: SiteCandidate; run: () => Thenable<unknown> } | undefined;
  const drafts = host.drafts();
  const names = candidates.map(c => c.label);
  const repeated = new Set(names.filter((n, i) => names.indexOf(n) !== i));

  const siteItem = (site: SiteCandidate): Item => {
    const showing = site.key === host.currentKey;
    const count = drafts.get(site.key);
    const parts = [
      // Nome repetido: a pasta, para distinguir sem passar o mouse
      repeated.has(site.label) ? site.description.split('/').pop() : '',
      count?.draft ? (count.draft === 1 ? vscode.l10n.t('1 draft') : vscode.l10n.t('{0} drafts', count.draft)) : '',
      count?.review ? vscode.l10n.t('{0} in review', count.review) : '',
      showing ? vscode.l10n.t('showing now') : '',
    ];
    return {
      label: `$(${showing ? 'check' : site.remote ? 'github' : 'book'}) ${site.label}`,
      description: parts.filter(Boolean).join(' · '),
      buttons: [folderButton(site.remote ? `${site.remote.host}/${site.description}` : `~/${site.description}`), ...(showing ? [] : [hideButton])],
      site,
    };
  };
  const folderItem = (folder: vscode.Uri): Item => ({
    label: `$(add) ${folder.path.split('/').pop()}`,
    description: vscode.l10n.t('create documentation here'),
    buttons: [folderButton(vscode.workspace.asRelativePath(folder))],
    folder,
  });
  const separator = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator });
  const createItem = (): Item => ({
    label: `$(add) ${vscode.l10n.t('Create documentation in a folder…')}`,
    description: empty?.length ? vscode.l10n.t('{0} folders without documentation', empty.length) : undefined,
    action: 'create',
    alwaysShow: true,
  });

  const render = () => {
    const items: Item[] = [];
    if (undo) items.push({ label: `$(discard) ${vscode.l10n.t('Undo: {0} left the list', undo.site.label)}`, action: 'undo', alwaysShow: true });
    const recent = host.recents.map(key => candidates.find(c => c.key === key)).filter((c): c is SiteCandidate => Boolean(c)).slice(0, RECENT_COUNT);
    if (quickPick.value) {
      // Busca: todos os sites, as páginas e as pastas sem documentação (o VS Code filtra)
      items.push(separator(vscode.l10n.t('sites')), ...sorted(candidates).map(siteItem));
      if (pages.length) {
        items.push(separator(vscode.l10n.t('pages')));
        items.push(...pages.map(p => ({ label: `$(file) ${p.title}`, description: p.site.label, page: { uri: p.uri, remote: Boolean(p.site.remote) } })));
      }
      if (empty?.length) items.push(separator(vscode.l10n.t('without documentation yet')), ...empty.map(folderItem));
      items.push(createItem());
    } else if (mode === 'recent' && recent.length && candidates.length > recent.length) {
      items.push(separator(vscode.l10n.t('recent')), ...recent.map(siteItem));
      items.push({ label: `$(ellipsis) ${vscode.l10n.t('See all sites ({0})', candidates.length)}`, action: 'all' }, createItem());
    } else {
      // Todos: só os repositórios com mais de um site têm grupo; os outros ficam juntos
      const byRepo = new Map<string, SiteCandidate[]>();
      for (const site of sorted(candidates)) byRepo.set(site.repo, [...(byRepo.get(site.repo) ?? []), site]);
      const single: SiteCandidate[] = [];
      for (const [repo, sites] of [...byRepo].sort(([a], [b]) => a.localeCompare(b))) {
        if (sites.length > 1) items.push(separator(repo.split('/').pop()!), ...sites.map(siteItem));
        else single.push(sites[0]);
      }
      if (single.length) items.push(separator(byRepo.size > single.length ? vscode.l10n.t('other repositories') : ''), ...sorted(single).map(siteItem));
      if (empty?.length) items.push(separator(vscode.l10n.t('without documentation yet')), ...empty.map(folderItem));
      if (recent.length && candidates.length > recent.length) items.push({ label: `$(arrow-left) ${vscode.l10n.t('Back to recent sites')}`, action: 'recent' });
      items.push(createItem());
    }
    quickPick.items = items;
  };

  quickPick.onDidChangeValue(() => render());
  quickPick.onDidTriggerButton(async button => {
    quickPick.hide();
    if (button === titleButtons.create) await newSiteInFolder();
    else if (button === titleButtons.github) await vscode.commands.executeCommand('techdocsEditor.openRemote');
    else if (button === titleButtons.folder) await vscode.commands.executeCommand('workbench.action.files.openFolder');
    else if (button === titleButtons.choose) await vscode.commands.executeCommand('techdocsEditor.chooseSites');
  });
  quickPick.onDidTriggerItemButton(async ({ item, button }) => {
    const site = item.site;
    if (button === hideButton && site) {
      candidates = candidates.filter(c => c.key !== site.key);
      if (site.remote) {
        const entry = site.remote;
        await host.remotes.remove(entry);
        undo = { site, run: () => host.remotes.add(entry) };
      } else if (site.local) {
        const config = vscode.workspace.getConfiguration('techdocsEditor');
        const before = config.inspect<string[] | null>('sites')?.workspaceValue;
        await hideSite(host.sites, site.local.mkdocs.with({ path: site.local.site.root }));
        undo = { site, run: () => config.update('sites', before, vscode.ConfigurationTarget.Workspace) };
      }
      return render();
    }
    // Botão da pasta: o site no Explorer (do GitHub: a pasta no GitHub)
    quickPick.hide();
    if (site?.remote) await vscode.env.openExternal(vscode.Uri.parse(`https://${site.remote.host}/${site.remote.slug}/tree/HEAD/${site.remote.root}`));
    else if (site?.local) await vscode.commands.executeCommand('revealInExplorer', site.local.mkdocs);
    else if (item.folder) await vscode.commands.executeCommand('revealInExplorer', item.folder);
  });
  quickPick.onDidAccept(async () => {
    const item = quickPick.selectedItems[0];
    if (!item) return;
    if (item.action === 'all' || item.action === 'recent') {
      mode = item.action;
      return render();
    }
    if (item.action === 'undo' && undo) {
      const { site, run } = undo;
      undo = undefined;
      await run();
      candidates = [...candidates, site];
      return render();
    }
    quickPick.hide();
    if (item.site) await host.select(item.site.key);
    else if (item.page) {
      await vscode.commands.executeCommand(item.page.remote ? 'techdocsEditor.openVisual' : 'vscode.open', item.page.uri);
    } else if (item.folder) await createIn(item.folder);
    else if (item.action === 'create') await newSiteInFolder();
  });
  quickPick.onDidHide(() => quickPick.dispose());
  render();
  quickPick.show();

  // Em segundo plano: as páginas (para a busca) e as pastas sem documentação
  void Promise.all([
    loadPages(candidates).then(found => {
      pages = found;
      if (quickPick.value) render();
    }),
    foldersWithoutDocs(candidates).then(found => {
      empty = found;
      render();
    }),
  ]);
}

const sorted = (list: SiteCandidate[]) => [...list].sort((a, b) => a.label.localeCompare(b.label) || a.description.localeCompare(b.description));

/** Os títulos das páginas dos sites locais (o título 1, ou o nome do arquivo). */
async function loadPages(candidates: SiteCandidate[]) {
  const result: Array<{ title: string; uri: vscode.Uri; site: SiteCandidate }> = [];
  for (const site of candidates) {
    if (!site.local || result.length >= MAX_PAGES) continue;
    let loading = pageCache.get(site.key);
    if (!loading) {
      const docsDir = site.local.mkdocs.with({ path: site.local.site.docsDir });
      loading = (async () => {
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(docsDir, '**/*.md'), undefined, MAX_PAGES);
        return Promise.all(
          files.map(async uri => {
            const text = await vscode.workspace.fs.readFile(uri).then(bytes => new TextDecoder().decode(bytes), () => '');
            return { title: pageTitle(text) ?? uri.path.split('/').pop()!.replace(/\.md$/i, ''), uri };
          }),
        );
      })();
      pageCache.set(site.key, loading);
    }
    for (const page of await loading) result.push({ ...page, site });
  }
  return result;
}

/**
 * Pastas do workspace onde dá para criar documentação: repositórios Git e pastas vazias, até três níveis, sem um
 * site dentro. Não entra em repositórios (uma pasta dentro de um repositório vai pelo seletor de pastas).
 */
export async function foldersWithoutDocs(candidates: readonly SiteCandidate[]): Promise<vscode.Uri[]> {
  const siteRoots = candidates.flatMap(c => (c.local ? [c.local.site.root] : []));
  const hasSite = (path: string) => siteRoots.some(root => root === path || root.startsWith(`${path}/`));
  const found: vscode.Uri[] = [];
  const visit = async (dir: vscode.Uri, depth: number) => {
    const entries = await vscode.workspace.fs.readDirectory(dir).then(e => e, () => undefined);
    if (!entries) return;
    if (depth > 0 && (!entries.length || entries.some(([name]) => name === '.git'))) {
      if (!hasSite(dir.path)) found.push(dir);
      return;
    }
    if (depth >= FOLDER_DEPTH) return;
    await Promise.all(
      entries
        .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.') && !SKIPPED.has(name))
        .map(([name]) => visit(vscode.Uri.joinPath(dir, name), depth + 1)),
    );
  };
  for (const folder of vscode.workspace.workspaceFolders ?? []) await visit(folder.uri, 0);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * "Criar documentação numa pasta…": a pasta (uma vazia, por exemplo) e o "Novo site de documentação" nela; o
 * site criado entra na lista e a página inicial aberta o mostra na árvore.
 */
export async function newSiteInFolder() {
  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Choose the folder for the new documentation'),
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Create the documentation here'),
  });
  if (picked?.[0]) await createIn(picked[0]);
}

async function createIn(folder: vscode.Uri) {
  const created = await vscode.commands.executeCommand<{ mkdocs: vscode.Uri } | undefined>('techdocsEditor.newSite', folder);
  // Fora do workspace a extensão não vê o site: oferece abrir a pasta
  if (!created || vscode.workspace.getWorkspaceFolder(folder)) return;
  const open = vscode.l10n.t('Open the folder');
  const answer = await vscode.window.showInformationMessage(
    vscode.l10n.t('The documentation was created in {0}, outside this workspace. Open that folder to edit it.', folder.fsPath),
    open,
  );
  if (answer === open) await vscode.commands.executeCommand('vscode.openFolder', folder, { forceNewWindow: true });
}
