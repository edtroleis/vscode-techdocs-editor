import * as vscode from 'vscode';
import { pageTitle } from '@edtroleis/techdocs-editor-core';
import { hideSite } from './chooseSites';
import type { SiteCandidate } from './docsTreeView';
import type { LocalSites } from './localSites';
import type { RemoteRepos } from './remote/remoteRepos';

/** Quantos sites recentes a árvore guarda. */
export const RECENT_COUNT = 5;
/** Até onde procurar pastas sem documentação, a partir da pasta do workspace. */
const FOLDER_DEPTH = 3;
const MAX_PAGES = 3000;
const SKIPPED = new Set(['node_modules', 'site', 'out', 'dist', 'build', 'target', 'vendor']);

/** O que a lista precisa da árvore. */
export type PickerHost = {
  /** Onde a lista começa (a pasta de cima do repositório mostrado); sem ela, na pasta aberta. */
  start?: vscode.Uri;
  candidates: readonly SiteCandidate[];
  /** Monta a árvore de novo (com os sites achados ao entrar numa pasta) e devolve os sites. */
  refresh(): Promise<readonly SiteCandidate[]>;
  currentKey: string | undefined;
  select(key: string): Promise<void>;
  /** Mostra uma pasta sem documentação na árvore (com a tela de criar nela). */
  selectFolder(folder: vscode.Uri): Promise<void>;
  /** Rascunhos da pessoa por site (de "Minhas alterações"). */
  drafts(): Map<string, { draft: number; review: number }>;
  sites: LocalSites;
  remotes: RemoteRepos;
};

type Item = vscode.QuickPickItem & {
  site?: SiteCandidate;
  page?: { uri: vscode.Uri; remote: boolean };
  /** Pasta sem documentação achada na busca: criar nela. */
  folder?: vscode.Uri;
  /** Entrar na pasta (`to` undefined: a lista das pastas do workspace). */
  enter?: { to: vscode.Uri | undefined };
  action?: 'create' | 'useHere' | 'undo' | 'goto';
  /** Pasta fora do workspace: abri-la no VS Code (a extensão só edita o que está aberto). */
  open?: vscode.Uri;
  /** "Ir para" um caminho digitado. */
  path?: string;
};

/** Páginas lidas de cada site local (título e arquivo), até a árvore mudar. */
let pageCache = new Map<string, Promise<Array<{ title: string; uri: vscode.Uri }>>>();
export function invalidatePages() {
  pageCache = new Map();
}

/**
 * "Trocar diretório ou repo" pelas pastas: começa na pasta aberta no VS Code e mostra o que tem dentro, com ou sem
 * documentação. "Voltar" sobe além da pasta aberta, até `/`; digitar um caminho (`/opt`, `~/projetos`) vai direto
 * a ele. Fora do workspace, um site ou a pasta abrem no VS Code (nesta janela ou em outra). Uma pasta que é um site mostra o nome dele (clicar o abre na árvore); uma pasta com sites dentro
 * diz quantos (clicar entra); uma sem nada diz "sem documentação" (dentro, "Criar documentação aqui"). "Voltar"
 * sobe. Ao digitar, a busca vale para todos os sites, as páginas deles e as pastas sem documentação.
 */
export async function pickSite(host: PickerHost) {
  const quickPick = vscode.window.createQuickPick<Item>();
  quickPick.placeholder = vscode.l10n.t('Search sites, pages and folders, or type a path (/opt, ~/code)');
  quickPick.matchOnDescription = true;
  const titleButtons = {
    create: { iconPath: new vscode.ThemeIcon('new-folder'), tooltip: vscode.l10n.t('Create documentation in a folder…') },
    github: { iconPath: new vscode.ThemeIcon('github'), tooltip: vscode.l10n.t('Open from GitHub by link…') },
    folder: { iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: vscode.l10n.t('Open another folder…') },
  };
  quickPick.buttons = [titleButtons.create, titleButtons.github, titleButtons.folder];
  const folderButton = (tooltip: string) => ({ iconPath: new vscode.ThemeIcon('folder'), tooltip });
  const hideButton = { iconPath: new vscode.ThemeIcon('close'), tooltip: vscode.l10n.t('Hide from this list') };

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  // Com uma pasta só no workspace, começa nela; com várias, na lista delas
  const top = workspaceFolders.length === 1 ? workspaceFolders[0].uri : undefined;
  let here = host.start ?? top;
  let entries: Array<{ uri: vscode.Uri; name: string }> | undefined;
  let candidates = [...host.candidates];
  let pages: Array<{ title: string; uri: vscode.Uri; site: SiteCandidate }> = [];
  let empty: vscode.Uri[] | undefined;
  /** Fora do workspace: as pastas (a atual e as de dentro) que têm um `mkdocs.yml`. */
  let outsideSites = new Set<string>();
  /** O caminho digitado que não é uma pasta. */
  let notFound: string | undefined;
  /** O último site escondido pelo ×, para desfazer. */
  let undo: { site: SiteCandidate; run: () => Thenable<unknown> } | undefined;
  const drafts = host.drafts();
  /** Os sites locais dentro da pasta (ou nela mesma). */
  const sitesIn = (path: string) => candidates.filter(c => c.local && (c.local.site.root === path || c.local.site.root.startsWith(`${path}/`)));

  /** `folder`: na navegação, a linha é o diretório (pelo nome dele) e o nome do site vai na descrição. */
  const siteItem = (site: SiteCandidate, extra?: string, folder?: string): Item => {
    const showing = site.key === host.currentKey;
    const count = drafts.get(site.key);
    const parts = [
      folder && !showing ? vscode.l10n.t('documentation: {0}', site.label) : '',
      extra,
      count?.draft ? (count.draft === 1 ? vscode.l10n.t('1 draft') : vscode.l10n.t('{0} drafts', count.draft)) : '',
      count?.review ? vscode.l10n.t('{0} in review', count.review) : '',
      showing ? vscode.l10n.t('showing now') : '',
    ];
    return {
      label: `$(${showing ? 'check' : folder ? 'folder' : site.remote ? 'github' : 'book'}) ${folder ?? site.label}`,
      description: parts.filter(Boolean).join(' · '),
      buttons: [folderButton(site.remote ? `${site.remote.host}/${site.description}` : `~/${site.description}`), ...(showing ? [] : [hideButton])],
      site,
    };
  };
  const folderItem = (folder: vscode.Uri): Item => ({
    label: `$(folder) ${folder.path.split('/').pop()}`,
    description: vscode.l10n.t('no documentation'),
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
  /**
   * A pasta de cima: undefined numa das pastas de um workspace com várias (volta à lista delas), null na raiz `/`.
   * Numa pasta só, sobe além dela (fora do workspace).
   */
  const parentOf = (uri: vscode.Uri): vscode.Uri | undefined | null => {
    if (workspaceFolders.length > 1 && workspaceFolders.some(f => f.uri.path === uri.path)) return undefined;
    const path = uri.path.replace(/\/+$/, '');
    if (!path) return null;
    return uri.with({ path: path.slice(0, path.lastIndexOf('/')) || '/' });
  };
  const inWorkspace = (uri: vscode.Uri) => Boolean(vscode.workspace.getWorkspaceFolder(uri));
  const nameOf = (uri: vscode.Uri) => uri.path.replace(/\/+$/, '').split('/').pop() || '/';

  /** Fora do workspace: as pastas com `mkdocs.yml` abrem no VS Code; as outras, entra. */
  const browseOutside = (at: vscode.Uri, items: Item[]): Item[] => {
    const opens = vscode.l10n.t('opens in VS Code');
    if (outsideSites.has(at.path)) items.push({ label: `$(book) ${nameOf(at)}`, description: `${vscode.l10n.t('this folder')} · ${opens}`, open: at });
    for (const row of entries ?? []) {
      items.push(
        outsideSites.has(row.uri.path)
          ? { label: `$(book) ${row.name}`, description: `${vscode.l10n.t('documentation')} · ${opens}`, open: row.uri }
          : { label: `$(folder) ${row.name}`, enter: { to: row.uri } },
      );
    }
    if (!outsideSites.has(at.path)) items.push({ label: `$(folder-opened) ${vscode.l10n.t('Open this folder in VS Code')}`, description: shortPath(at), open: at, alwaysShow: true });
    return items;
  };

  const browse = (): Item[] => {
    const items: Item[] = [];
    const up = here ? parentOf(here) : null;
    if (up !== null) {
      items.push({ label: `$(arrow-up) ${vscode.l10n.t('Back to {0}', up ? shortPath(up) : vscode.l10n.t('the workspace folders'))}`, enter: { to: up }, alwaysShow: true });
    }
    if (here && !inWorkspace(here)) return browseOutside(here, items);
    const self = here && candidates.find(c => c.local?.site.root === here!.path);
    if (self) items.push(siteItem(self, vscode.l10n.t('this folder')));
    const rows = (entries ?? []).map(entry => ({ ...entry, sites: sitesIn(entry.uri.path) }));
    for (const row of rows.filter(r => r.sites.length)) {
      const [only] = row.sites;
      if (row.sites.length === 1 && only.local!.site.root === row.uri.path) items.push(siteItem(only, undefined, row.name));
      else {
        // Sem número: os sites mais fundos que o limite da busca só entram ao chegar na pasta deles
        items.push({ label: `$(folder) ${row.name}`, description: vscode.l10n.t('documentation inside'), enter: { to: row.uri } });
      }
    }
    // Sem separador nem descrição: o VS Code desenha o texto do separador ao lado da primeira linha, e a falta da
    // descrição já diz que o diretório não tem documentação
    items.push(...rows.filter(r => !r.sites.length).map((row): Item => ({ label: `$(folder) ${row.name}`, enter: { to: row.uri } })));
    if (here && !self && !sitesIn(here.path).length) {
      items.push({ label: `$(check) ${vscode.l10n.t('Use this folder')}`, description: `${shortPath(here)} · ${vscode.l10n.t('to create its documentation')}`, action: 'useHere', alwaysShow: true });
    }
    // Os sites abertos do GitHub ficam na pasta de cima
    const remote = candidates.filter(c => c.remote);
    if (here?.path === top?.path && remote.length) items.push(separator('GitHub'), ...sorted(remote).map(site => siteItem(site)));
    if (entries && !items.length) items.push({ label: vscode.l10n.t('This folder is empty.'), alwaysShow: true });
    return items;
  };

  const render = () => {
    const items: Item[] = [];
    if (undo) items.push({ label: `$(discard) ${vscode.l10n.t('Undo: {0} left the list', undo.site.label)}`, action: 'undo', alwaysShow: true });
    const typed = pathOf(quickPick.value, here ?? top ?? workspaceFolders[0]?.uri);
    if (typed) {
      // Um caminho digitado: ir direto à pasta
      quickPick.title = vscode.l10n.t('Switch directory or repo');
      items.push(
        notFound === typed.path
          ? { label: `$(error) ${vscode.l10n.t('Folder not found: {0}', shortPath(typed))}`, alwaysShow: true }
          : { label: `$(arrow-right) ${vscode.l10n.t('Go to {0}', shortPath(typed))}`, action: 'goto', path: typed.path, alwaysShow: true },
      );
    } else if (quickPick.value) {
      // Busca: todos os sites, as páginas e as pastas sem documentação (o VS Code filtra)
      quickPick.title = vscode.l10n.t('Switch directory or repo');
      items.push(separator(vscode.l10n.t('sites')), ...sorted(candidates).map(site => siteItem(site)));
      if (pages.length) {
        items.push(separator(vscode.l10n.t('pages')));
        items.push(...pages.map(p => ({ label: `$(file) ${p.title}`, description: p.site.label, page: { uri: p.uri, remote: Boolean(p.site.remote) } })));
      }
      if (empty?.length) items.push(separator(vscode.l10n.t('without documentation yet')), ...empty.map(folderItem));
      items.push(createItem());
    } else {
      quickPick.title = here ? shortPath(here) : vscode.l10n.t('Workspace folders');
      items.push(...browse());
    }
    quickPick.busy = !entries;
    quickPick.items = items;
  };

  const load = async () => {
    entries = undefined;
    render();
    const at = here;
    const found = at
      ? ((await vscode.workspace.fs.readDirectory(at).then(e => e, () => [])) as [string, vscode.FileType][])
          .filter(([name, type]) => type & vscode.FileType.Directory && !name.startsWith('.') && !SKIPPED.has(name))
          .map(([name]) => ({ uri: vscode.Uri.joinPath(at, name), name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : workspaceFolders.map(f => ({ uri: f.uri, name: f.name }));
    if (at && !inWorkspace(at)) {
      // Fora do workspace: só se a pasta e as de dentro têm um mkdocs.yml (a extensão não as acompanha)
      const withSite = await Promise.all([at, ...found.map(f => f.uri)].map(async uri => ((await hasMkdocs(uri)) ? uri.path : '')));
      if (at !== here) return;
      outsideSites = new Set(withSite.filter(Boolean));
      entries = found;
      return render();
    }
    if (at !== here) return;
    entries = found;
    render();
    // Sites mais fundos que o limite da busca do workspace: entram ao chegar na pasta deles
    if (!at) return;
    const before = host.sites.all().length;
    await host.sites.discover(at);
    if (host.sites.all().length === before || at !== here) return;
    const hidden = new Set(host.candidates.map(c => c.key).filter(key => !candidates.some(c => c.key === key)));
    candidates = (await host.refresh()).filter(c => !hidden.has(c.key));
    if (at === here) render();
  };

  quickPick.onDidChangeValue(() => {
    notFound = undefined;
    render();
  });
  quickPick.onDidTriggerButton(async button => {
    quickPick.hide();
    if (button === titleButtons.create) await newSiteInFolder();
    else if (button === titleButtons.github) await vscode.commands.executeCommand('techdocsEditor.openRemote');
    else if (button === titleButtons.folder) await vscode.commands.executeCommand('workbench.action.files.openFolder');
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
    if (item.enter) {
      here = item.enter.to;
      quickPick.value = '';
      return load();
    }
    if (item.action === 'goto' && item.path) {
      const target = (here ?? top ?? workspaceFolders[0]!.uri).with({ path: item.path });
      const stat = await Promise.resolve(vscode.workspace.fs.stat(target)).then(s => s, () => undefined);
      if (!stat || !(stat.type & vscode.FileType.Directory)) {
        notFound = item.path;
        return render();
      }
      here = target;
      quickPick.value = '';
      return load();
    }
    if (item.open) {
      quickPick.hide();
      return openFolder(item.open);
    }
    if (item.action === 'undo' && undo) {
      const { site, run } = undo;
      undo = undefined;
      await run();
      candidates = [...candidates, site];
      return render();
    }
    if (!item.site && !item.page && !item.folder && !item.action) return;
    quickPick.hide();
    if (item.site) await host.select(item.site.key);
    else if (item.page) {
      await vscode.commands.executeCommand(item.page.remote ? 'techdocsEditor.openVisual' : 'vscode.open', item.page.uri);
    } else if (item.folder) await host.selectFolder(item.folder);
    else if (item.action === 'useHere' && here) await host.selectFolder(here);
    else if (item.action === 'create') await newSiteInFolder();
  });
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
  await load();

  // Em segundo plano: as páginas (para a busca) e as pastas sem documentação
  void Promise.all([
    loadPages(candidates).then(found => {
      pages = found;
      if (quickPick.value) render();
    }),
    foldersWithoutDocs(candidates).then(found => {
      empty = found;
      if (quickPick.value) render();
    }),
  ]);
}

/** A pasta para mostrar: `~/code` no home, senão o caminho do workspace. */
function shortPath(uri: vscode.Uri): string {
  const home = /^\/(?:home|Users)\/[^/]+/.exec(uri.path)?.[0];
  return home ? `~${uri.path.slice(home.length)}` : vscode.workspace.asRelativePath(uri, true) || uri.path;
}

/** O caminho digitado (`/opt`, `~/projetos`, `~`), com o esquema da pasta atual; undefined se não é um caminho. */
export function pathOf(value: string, base: vscode.Uri | undefined): vscode.Uri | undefined {
  const text = value.trim();
  if (!base || !/^(\/|~(\/|$))/.test(text)) return undefined;
  let path = text;
  if (text.startsWith('~')) {
    const home = homeDir(base);
    if (!home) return undefined;
    path = home + text.slice(1);
  }
  path = path.replace(/\/+$/, '') || '/';
  return base.with({ path });
}

/** A pasta pessoal: a do ambiente, senão a de `/home/x` ou `/Users/x` na pasta aberta. */
function homeDir(base: vscode.Uri): string | undefined {
  const env = typeof process !== 'undefined' ? process.env?.HOME : undefined;
  return env?.replace(/\/+$/, '') || /^\/(?:home|Users)\/[^/]+/.exec(base.path)?.[0];
}

const hasMkdocs = async (dir: vscode.Uri) => {
  for (const name of ['mkdocs.yml', 'mkdocs.yaml']) {
    if (await Promise.resolve(vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, name))).then(() => true, () => false)) return true;
  }
  return false;
};

/** Abre a pasta fora do workspace: nesta janela ou numa nova. */
async function openFolder(folder: vscode.Uri) {
  const here = vscode.l10n.t('This window');
  const other = vscode.l10n.t('New window');
  const answer = await vscode.window.showInformationMessage(
    vscode.l10n.t('{0} is outside the folder open in VS Code. Open it to edit its documentation?', folder.fsPath),
    { modal: true },
    here,
    other,
  );
  if (answer) await vscode.commands.executeCommand('vscode.openFolder', folder, { forceNewWindow: answer === other });
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
