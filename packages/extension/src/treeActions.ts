import * as vscode from 'vscode';
import {
  fileNameFor,
  filesOnlyUsedBy,
  findPage,
  findSection,
  navFromTree,
  pageTitle,
  pagesLinkingTo,
  readNav,
  setPageTitle,
  writeNav,
  type NavItem,
  type NavPlace,
} from '@edtroleis/techdocs-editor-core';
import { DocsItem, type DocsTreeView } from './docsTreeView';

const MIME = 'application/vnd.code.tree.techdocseditor.docs';
const UNDO_LIMIT = 30;

/** Uma ação feita na árvore: os arquivos como estavam antes (undefined: não existia), para desfazer. */
type Undo = { label: string; files: Array<[vscode.Uri, Uint8Array | undefined]> };

/** Testes de integração: as respostas das perguntas (modal, caixa de texto, lista), na ordem. */
let testAnswers: Array<string | undefined> | undefined;
export function useTestAnswers(answers: Array<string | undefined> | undefined) {
  testAnswers = answers;
}

/**
 * As ações da árvore "Documentação" nos sites do workspace (spec 02, árvore v2): renomear (o título da página
 * ou o nome da seção), duplicar, mover (para cima, para baixo, para outra seção, arrastando), excluir (página ou
 * seção, com ou sem as páginas), nova seção e pôr no menu uma página que está fora dele. Tudo que muda o menu
 * grava o `nav` do `mkdocs.yml`; num site sem `nav`, a primeira vez pergunta e escreve o menu de hoje. Cada ação
 * guarda os arquivos de antes: "Desfazer" (e Ctrl+Z na árvore) os põe de volta.
 */
export class TreeActions implements vscode.TreeDragAndDropController<DocsItem> {
  readonly dragMimeTypes = [MIME];
  readonly dropMimeTypes = [MIME];
  private docs!: DocsTreeView;
  private readonly undos: Undo[] = [];

  use(docs: DocsTreeView) {
    this.docs = docs;
  }

  /** Item do comando: o da árvore (menu, botão) ou o selecionado (atalho de teclado). */
  private itemOf(target: unknown): DocsItem | undefined {
    return target instanceof DocsItem ? target : this.docs.selected();
  }

  /** O site do workspace do item, ou o aviso de que no GitHub a ação ainda não existe. */
  private siteOf(item: DocsItem | undefined) {
    const site = this.docs.localSite;
    if (item && !item.local) {
      void vscode.window.showInformationMessage(vscode.l10n.t('On GitHub sites this is not available yet. Open the repository in a local folder to do it.'));
      return undefined;
    }
    return site;
  }

  // ---------- perguntas (com respostas fixas nos testes) ----------

  private async ask(message: string, detail: string, ...buttons: string[]): Promise<string | undefined> {
    if (testAnswers) return testAnswers.shift();
    return vscode.window.showWarningMessage(message, { modal: true, detail }, ...buttons);
  }

  private async input(options: vscode.InputBoxOptions): Promise<string | undefined> {
    if (testAnswers) {
      const answer = testAnswers.shift();
      const problem = answer === undefined ? undefined : await options.validateInput?.(answer);
      if (problem) throw new Error(typeof problem === 'string' ? problem : problem.message);
      return answer;
    }
    return vscode.window.showInputBox(options);
  }

  private async pick<T extends vscode.QuickPickItem>(items: T[], options: vscode.QuickPickOptions): Promise<T | undefined> {
    if (testAnswers) {
      const answer = testAnswers.shift();
      return items.find(i => i.label.replace(/^\$\([\w-]+\)\s*/, '') === answer);
    }
    return vscode.window.showQuickPick(items, options);
  }

  /** Aviso com "Desfazer" (só se a ação ainda é a última). */
  private done(message: string, undo: Undo | undefined, ...more: Array<{ label: string; run: () => unknown }>) {
    const undoLabel = vscode.l10n.t('Undo');
    const buttons = [...(undo ? [undoLabel] : []), ...more.map(m => m.label)];
    void vscode.window.showInformationMessage(message, ...buttons).then(answer => {
      if (answer === undoLabel && undo) return this.undo(undo);
      return more.find(m => m.label === answer)?.run();
    });
  }

  // ---------- gravar, com o que desfazer ----------

  /** Faz a ação guardando antes os arquivos que ela muda; monta a árvore de novo no fim. */
  private async change(label: string, uris: vscode.Uri[], run: () => Promise<void>): Promise<Undo> {
    const files = await Promise.all(uris.map(async (uri): Promise<[vscode.Uri, Uint8Array | undefined]> => [uri, await readBytes(uri)]));
    const undo: Undo = { label, files };
    try {
      await run();
    } finally {
      this.undos.push(undo);
      if (this.undos.length > UNDO_LIMIT) this.undos.shift();
      await this.docs.refreshNow();
    }
    return undo;
  }

  /** Desfaz a última ação da árvore (Ctrl+Z), ou a do aviso, se ainda for a última. */
  async undo(which?: Undo) {
    const last = this.undos[this.undos.length - 1];
    if (!last) return void vscode.window.showInformationMessage(vscode.l10n.t('Nothing to undo in the documentation tree.'));
    if (which && which !== last) return void vscode.window.showInformationMessage(vscode.l10n.t('Only the last change in the tree can be undone.'));
    this.undos.pop();
    for (const [uri, data] of last.files) {
      if (data) await vscode.workspace.fs.writeFile(uri, data);
      else {
        await vscode.workspace.fs.delete(uri, { useTrash: false }).then(undefined, () => {});
        await removeIfEmpty(vscode.Uri.joinPath(uri, '..'));
      }
    }
    await this.docs.refreshNow();
    void vscode.window.showInformationMessage(vscode.l10n.t('Undone: {0}', last.label));
  }

  // ---------- menu do site ----------

  private async readYml(mkdocs: vscode.Uri) {
    return (await readText(mkdocs)) ?? '';
  }

  /**
   * O menu para mexer. Sem `nav` (o MkDocs monta pelas pastas), pergunta uma vez e passa a usar o de hoje, igual
   * ao que aparece; cancelar: undefined.
   */
  private async navToEdit(yml: string, site: NonNullable<DocsTreeView['localSite']>): Promise<NavItem[] | undefined> {
    const nav = readNav(yml);
    if (nav) return nav;
    const organize = vscode.l10n.t('Organize the menu');
    const answer = await this.ask(
      vscode.l10n.t('Organize the menu of this site?'),
      vscode.l10n.t(
        'Today the menu follows the alphabetical order of the files and uses the folder names for the sections. To choose the order and the names, the menu is saved in the site (mkdocs.yml). Nothing changes on the site until you move something.',
      ),
      organize,
    );
    return answer === organize ? navFromTree(site.tree.nodes) : undefined;
  }

  /** O lugar do item no menu: a página pelo caminho, a seção pelos títulos. */
  private placeOf(nav: NavItem[], item: DocsItem): NavPlace | undefined {
    if (item.kind === 'page' && item.path) return findPage(nav, item.path);
    if (item.kind === 'section' && item.trail) return findSection(nav, item.trail);
    return undefined;
  }

  // ---------- renomear ----------

  async rename(target?: unknown) {
    const item = this.itemOf(target);
    if (item?.kind === 'page') return this.renamePage(item);
    if (item?.kind === 'section') return this.renameSection(item);
  }

  private async renamePage(item: DocsItem) {
    const uri = item.uri!;
    const title = await this.input({
      title: vscode.l10n.t('Rename page'),
      value: item.label,
      prompt: vscode.l10n.t('The file stays {0}, so links do not break.', uri.path.split('/').pop()!),
      validateInput: value => (value.trim() ? undefined : vscode.l10n.t('Write a title.')),
    });
    if (!title?.trim() || title.trim() === item.label) return;
    const name = title.trim();
    // Pelo documento (aberto ou não): o editor aberto acompanha, e no GitHub o salvar grava o rascunho
    const document = await vscode.workspace.openTextDocument(uri);
    const apply = async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), setPageTitle(document.getText(), name));
      await vscode.workspace.applyEdit(edit);
      await document.save();
    };
    const site = item.local ? this.docs.localSite : undefined;
    if (!site) {
      await apply();
      await this.docs.refreshNow();
      return void vscode.window.showInformationMessage(vscode.l10n.t('The page is now called "{0}".', name));
    }
    const undo = await this.change(vscode.l10n.t('rename "{0}"', item.label), [uri, site.mkdocs], async () => {
      await apply();
      // Título escrito no menu: muda também, senão o menu continua com o velho
      const yml = await this.readYml(site.mkdocs);
      const nav = readNav(yml);
      const place = nav && item.path ? findPage(nav, item.path) : undefined;
      const entry = place?.list[place.index];
      if (nav && entry?.kind === 'page' && entry.title !== undefined) {
        entry.title = name;
        await writeText(site.mkdocs, writeNav(yml, nav));
      }
    });
    this.done(vscode.l10n.t('The page is now called "{0}". The file stays {1}, so links do not break.', name, uri.path.split('/').pop()!), undo);
  }

  private async renameSection(item: DocsItem) {
    const site = this.siteOf(item);
    if (!site) return;
    const yml = await this.readYml(site.mkdocs);
    const nav = await this.navToEdit(yml, site);
    const place = nav && this.placeOf(nav, item);
    if (!nav || !place) return;
    const siblings = place.list.filter((other, i) => i !== place.index && other.kind === 'section').map(other => (other as { title: string }).title.toLowerCase());
    const title = await this.input({
      title: vscode.l10n.t('Rename section'),
      value: item.label,
      prompt: vscode.l10n.t('Only the name in the menu changes; the folder stays the same.'),
      validateInput: value =>
        !value.trim() ? vscode.l10n.t('Write a name.') : siblings.includes(value.trim().toLowerCase()) ? vscode.l10n.t('There is already a section "{0}" here.', value.trim()) : undefined,
    });
    if (!title?.trim() || title.trim() === item.label) return;
    (place.list[place.index] as Extract<NavItem, { kind: 'section' }>).title = title.trim();
    const undo = await this.change(vscode.l10n.t('rename "{0}"', item.label), [site.mkdocs], () => writeText(site.mkdocs, writeNav(yml, nav)));
    this.done(vscode.l10n.t('Section renamed to "{0}".', title.trim()), undo);
  }

  // ---------- duplicar ----------

  async duplicate(target?: unknown) {
    const item = this.itemOf(target);
    if (item?.kind !== 'page') return;
    const site = this.siteOf(item);
    if (!site || !item.uri || !item.path) return;
    const dir = vscode.Uri.joinPath(item.uri, '..');
    const title = await this.input({
      title: vscode.l10n.t('Duplicate page'),
      value: vscode.l10n.t('{0} (copy)', item.label),
      prompt: vscode.l10n.t('Title of the new page'),
      validateInput: async value => {
        if (!value.trim()) return vscode.l10n.t('Write a title.');
        return (await readBytes(vscode.Uri.joinPath(dir, fileNameFor(value.trim())))) ? vscode.l10n.t('There is already a file {0} here. Choose another title.', fileNameFor(value.trim())) : undefined;
      },
    });
    if (!title?.trim()) return;
    const copy = vscode.Uri.joinPath(dir, fileNameFor(title.trim()));
    const copyPath = item.path.slice(0, item.path.lastIndexOf('/') + 1) + fileNameFor(title.trim());
    const undo = await this.change(vscode.l10n.t('duplicate "{0}"', item.label), [copy, site.mkdocs], async () => {
      const text = (await readText(item.uri!)) ?? '';
      await writeText(copy, setPageTitle(text, title.trim()));
      // No menu, logo depois da original (se ela está nele)
      const yml = await this.readYml(site.mkdocs);
      const nav = readNav(yml);
      const place = nav && findPage(nav, item.path!);
      if (nav && place) {
        place.list.splice(place.index + 1, 0, { kind: 'page', path: copyPath });
        await writeText(site.mkdocs, writeNav(yml, nav));
      }
    });
    await vscode.commands.executeCommand('techdocsEditor.openVisual', copy);
    this.done(vscode.l10n.t('Page "{0}" created.', title.trim()), undo);
  }

  // ---------- mover ----------

  /** "Mover para…": para cima, para baixo, fora de seção ou uma seção. */
  async moveTo(target?: unknown) {
    const item = this.itemOf(target);
    if (!item || (item.kind !== 'page' && item.kind !== 'section') || item.home) return;
    const site = this.siteOf(item);
    if (!site) return;
    if (item.outside) return this.addToMenu(item);
    type Choice = vscode.QuickPickItem & { step?: -1 | 1; into?: string[] };
    const sections: Choice[] = [];
    const walk = (nodes: typeof site.tree.nodes, trail: string[]) => {
      for (const node of nodes) {
        if (node.kind !== 'section') continue;
        const at = [...trail, node.title];
        const inside = item.kind === 'section' && item.trail && at.join('\u0000').startsWith(item.trail.join('\u0000'));
        const current = item.parent?.trail?.join('\u0000') === at.join('\u0000');
        if (!inside) sections.push({ label: `$(folder) ${node.title}`, description: current ? vscode.l10n.t('current') : trail.join(' › '), into: at });
        walk(node.children, at);
      }
    };
    walk(site.tree.nodes, []);
    const top = !item.parent?.trail;
    const choice = await this.pick<Choice>(
      [
        { label: `$(arrow-up) ${vscode.l10n.t('Up')}`, step: -1 },
        { label: `$(arrow-down) ${vscode.l10n.t('Down')}`, step: 1 },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: `$(list-flat) ${vscode.l10n.t('Outside any section')}`, description: top ? vscode.l10n.t('current') : undefined, into: [] },
        ...sections,
      ],
      { title: vscode.l10n.t('Move "{0}"', item.label) },
    );
    if (!choice) return;
    if (choice.step) return this.step(item, choice.step);
    if (choice.into) return this.move(item, { into: choice.into });
  }

  async moveUp(target?: unknown) {
    const item = this.itemOf(target);
    if (item) await this.step(item, -1);
  }

  async moveDown(target?: unknown) {
    const item = this.itemOf(target);
    if (item) await this.step(item, 1);
  }

  private async step(item: DocsItem, step: -1 | 1) {
    if ((item.kind !== 'page' && item.kind !== 'section') || item.home || item.outside) return;
    await this.move(item, { step });
  }

  /**
   * Muda o item de lugar no menu: um passo (`step`), para o fim de uma seção (`into`, `[]` = fora de seção) ou
   * para antes de outro item (`before`). A página inicial fica sempre no topo.
   */
  private async move(item: DocsItem, where: { step?: -1 | 1; into?: string[]; before?: DocsItem }) {
    const site = this.siteOf(item);
    if (!site) return;
    const yml = await this.readYml(site.mkdocs);
    const nav = await this.navToEdit(yml, site);
    if (!nav) return;
    const from = this.placeOf(nav, item);
    if (!from) return;
    const homeFirst = (list: NavItem[]) => (list === nav && isHome(nav[0]) ? 1 : 0);
    let list: NavItem[];
    let index: number;
    if (where.step) {
      list = from.list;
      index = from.index + where.step;
      if (index < homeFirst(list) || index >= list.length) {
        return void vscode.window.showInformationMessage(where.step < 0 ? vscode.l10n.t('It is already the first one.') : vscode.l10n.t('It is already the last one.'));
      }
      const [moved] = list.splice(from.index, 1);
      list.splice(index, 0, moved);
    } else {
      const [moved] = from.list.splice(from.index, 1);
      if (where.before) {
        const place = this.placeOf(nav, where.before);
        if (!place) return;
        list = place.list;
        index = Math.max(place.index, homeFirst(list));
      } else {
        const section = where.into!.length ? findSection(nav, where.into!) : undefined;
        list = section ? (section.list[section.index] as Extract<NavItem, { kind: 'section' }>).children : nav;
        index = list.length;
      }
      list.splice(index, 0, moved);
    }
    const into = where.into ?? (where.before ? where.before.parent?.trail : undefined);
    const message =
      where.step || (into === undefined && where.before?.parent === item.parent)
        ? vscode.l10n.t('"{0}" changed position in the menu.', item.label)
        : into?.length
          ? vscode.l10n.t('"{0}" moved to "{1}".', item.label, into[into.length - 1])
          : vscode.l10n.t('"{0}" moved outside any section.', item.label);
    const undo = await this.change(vscode.l10n.t('move "{0}"', item.label), [site.mkdocs], () => writeText(site.mkdocs, writeNav(yml, nav)));
    await this.docs.revealItem(other => other.kind === item.kind && (item.path ? other.path === item.path : other.label === item.label));
    this.done(message, undo);
  }

  /** "Adicionar ao menu": a página de fora do `nav` entra no fim do menu. */
  async addToMenu(target?: unknown) {
    const item = this.itemOf(target);
    if (!item?.outside || !item.path) return;
    const site = this.siteOf(item);
    if (!site) return;
    const yml = await this.readYml(site.mkdocs);
    const nav = readNav(yml) ?? [];
    nav.push({ kind: 'page', path: item.path });
    const undo = await this.change(vscode.l10n.t('add "{0}" to the menu', item.label), [site.mkdocs], () => writeText(site.mkdocs, writeNav(yml, nav)));
    this.done(vscode.l10n.t('"{0}" now appears in the menu of the site.', item.label), undo);
  }

  // ---------- excluir ----------

  async delete(target?: unknown) {
    const item = this.itemOf(target);
    if (item?.kind === 'page') return this.deletePage(item);
    if (item?.kind === 'section') return this.deleteSection(item);
  }

  /** As páginas do site com o texto (para achar links e imagens). */
  private async allPages(docsDir: vscode.Uri) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(docsDir, '**/*.md'));
    return Promise.all(files.map(async uri => ({ uri, path: uri.path.slice(docsDir.path.length + 1), text: (await readText(uri)) ?? '' })));
  }

  private async deletePage(item: DocsItem) {
    if (item.home) {
      return void vscode.window.showInformationMessage(vscode.l10n.t('The home page of the site cannot be deleted: it is the page the portal opens first.'));
    }
    const site = this.siteOf(item);
    if (!site || !item.uri || !item.path) return;
    const pages = await this.allPages(site.docsDir);
    const page = pages.find(p => p.path === item.path) ?? { path: item.path, text: '', uri: item.uri };
    const linking = pagesLinkingTo(item.path, pages).map(path => pages.find(p => p.path === path)!);
    const names = linking.map(p => pageTitle(p.text) ?? p.path);
    const files = filesOnlyUsedBy(page, pages).map(path => vscode.Uri.joinPath(site.docsDir, path));
    const remove = vscode.l10n.t('Delete');
    const answer = await this.ask(
      vscode.l10n.t('Delete "{0}"?', item.label),
      [
        vscode.l10n.t('It goes to the trash, with the images used only by it. You can undo.'),
        linking.length === 1
          ? vscode.l10n.t('{0} links to it. That link will break.', names[0])
          : linking.length
            ? vscode.l10n.t('{0} link to it. Those links will break.', joinNames(names))
            : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      remove,
    );
    if (answer !== remove) return;
    const undo = await this.change(vscode.l10n.t('delete "{0}"', item.label), [item.uri, site.mkdocs, ...files], async () => {
      await closeTabs([item.uri!]);
      for (const uri of [item.uri!, ...files]) await trash(uri);
      const yml = await this.readYml(site.mkdocs);
      const nav = readNav(yml);
      if (nav && removePages(nav, new Set([item.path!]))) await writeText(site.mkdocs, writeNav(yml, nav));
    });
    const broken = linking.length ? ` ${linking.length === 1 ? vscode.l10n.t('1 page now has a broken link.') : vscode.l10n.t('{0} pages now have a broken link.', linking.length)}` : '';
    this.done(
      vscode.l10n.t('"{0}" deleted.', item.label) + broken,
      undo,
      ...(linking.length ? [{ label: vscode.l10n.t('See'), run: () => vscode.commands.executeCommand('techdocsEditor.openVisual', linking[0].uri) }] : []),
    );
  }

  private async deleteSection(item: DocsItem) {
    const site = this.siteOf(item);
    if (!site) return;
    const pageItems = descendants(item).filter(child => child.kind === 'page' && child.uri && child.path);
    const paths = new Set(pageItems.map(p => p.path!));
    const keepLabel = vscode.l10n.t('Only the section');
    const allLabel = vscode.l10n.t('Section and pages');
    let all = false;
    if (pageItems.length) {
      const pages = await this.allPages(site.docsDir);
      const outside = pages.filter(p => !paths.has(p.path));
      const linking = [...new Set([...paths].flatMap(path => pagesLinkingTo(path, outside)))].map(path => pages.find(p => p.path === path)!);
      const names = joinNames(linking.map(p => pageTitle(p.text) ?? p.path));
      const answer = await this.ask(
        vscode.l10n.t('Delete the section "{0}"?', item.label),
        [
          pageItems.length === 1 ? vscode.l10n.t('It has 1 page: {0}.', pageItems[0].label) : vscode.l10n.t('It has {0} pages: {1}.', pageItems.length, joinNames(pageItems.map(p => p.label))),
          vscode.l10n.t('Only the section: the pages stay on the site, outside any section.'),
          vscode.l10n.t('Section and pages: the pages go to the trash.') +
            (linking.length === 1 ? ` ${vscode.l10n.t('{0} links to them.', names)}` : linking.length ? ` ${vscode.l10n.t('{0} link to them.', names)}` : ''),
        ].join('\n\n'),
        keepLabel,
        allLabel,
      );
      if (answer !== keepLabel && answer !== allLabel) return;
      all = answer === allLabel;
    }
    const yml = await this.readYml(site.mkdocs);
    // Sem nav, a seção é a pasta: excluir tudo não precisa do menu; manter as páginas, sim
    const nav = all || !pageItems.length ? readNav(yml) : await this.navToEdit(yml, site);
    if (!all && pageItems.length && !nav) return;
    const place = nav && this.placeOf(nav, item);
    const uris = pageItems.map(p => p.uri!);
    const files = all ? await this.filesOnlyUsedByAll(site.docsDir, paths) : [];
    const undo = await this.change(vscode.l10n.t('delete the section "{0}"', item.label), [site.mkdocs, ...(all ? [...uris, ...files] : [])], async () => {
      if (all) {
        await closeTabs(uris);
        for (const uri of [...uris, ...files]) await trash(uri);
        for (const uri of uris) await removeIfEmpty(vscode.Uri.joinPath(uri, '..'));
      }
      if (nav && place) {
        const section = place.list[place.index] as Extract<NavItem, { kind: 'section' }>;
        place.list.splice(place.index, 1, ...(all ? [] : section.children));
        await writeText(site.mkdocs, writeNav(yml, nav));
      }
    });
    const n = pageItems.length;
    this.done(
      !n
        ? vscode.l10n.t('Section "{0}" deleted.', item.label)
        : all
          ? vscode.l10n.t('Section "{0}" and its pages deleted.', item.label)
          : n === 1
            ? vscode.l10n.t('Section "{0}" deleted. The page stays in the menu.', item.label)
            : vscode.l10n.t('Section "{0}" deleted. The pages stay in the menu.', item.label),
      undo,
    );
  }

  /** Imagens e anexos usados só pelas páginas dadas. */
  private async filesOnlyUsedByAll(docsDir: vscode.Uri, paths: Set<string>) {
    const pages = await this.allPages(docsDir);
    const others = pages.filter(p => !paths.has(p.path));
    const files = new Set(pages.filter(p => paths.has(p.path)).flatMap(p => filesOnlyUsedBy(p, others)));
    return [...files].map(path => vscode.Uri.joinPath(docsDir, path));
  }

  // ---------- nova seção ----------

  /** "Nova seção": a pasta, a primeira página (com o nome da seção) e a entrada no menu. */
  async newSection(target?: unknown) {
    const item = target instanceof DocsItem ? target : undefined;
    const site = this.siteOf(item);
    if (!site) {
      if (!item) void vscode.window.showInformationMessage(vscode.l10n.t('Choose a documentation site of this workspace first.'));
      return;
    }
    const titles = new Set(site.tree.nodes.filter(n => n.kind === 'section').map(n => n.title.toLowerCase()));
    const name = await this.input({
      title: vscode.l10n.t('New section'),
      placeHolder: vscode.l10n.t('Name of the section'),
      prompt: vscode.l10n.t('It starts with a page of the same name.'),
      validateInput: async value => {
        const clean = value.trim();
        if (!clean) return vscode.l10n.t('Write a name.');
        if (titles.has(clean.toLowerCase())) return vscode.l10n.t('There is already a section "{0}" here.', clean);
        const folder = fileNameFor(clean).replace(/\.md$/, '');
        return (await readBytes(vscode.Uri.joinPath(site.docsDir, folder, 'index.md'))) ? vscode.l10n.t('There is already a folder {0} with a page.', folder) : undefined;
      },
    });
    if (!name?.trim()) return;
    const title = name.trim();
    const folder = fileNameFor(title).replace(/\.md$/, '');
    const page = vscode.Uri.joinPath(site.docsDir, folder, 'index.md');
    const undo = await this.change(vscode.l10n.t('create the section "{0}"', title), [page, site.mkdocs], async () => {
      await writeText(page, `# ${title}\n\n`);
      const yml = await this.readYml(site.mkdocs);
      const nav = readNav(yml);
      if (!nav) return;
      const section: NavItem = { kind: 'section', title, children: [{ kind: 'page', path: `${folder}/index.md` }] };
      // Logo depois da seção clicada; senão no fim
      const after = item?.kind === 'section' ? this.placeOf(nav, item) : undefined;
      if (after) after.list.splice(after.index + 1, 0, section);
      else nav.push(section);
      await writeText(site.mkdocs, writeNav(yml, nav));
    });
    await vscode.commands.executeCommand('techdocsEditor.openVisual', page);
    this.done(vscode.l10n.t('Section "{0}" created, with a page of the same name open for you to write.', title), undo);
  }

  // ---------- arrastar ----------

  handleDrag(source: readonly DocsItem[], data: vscode.DataTransfer) {
    const [item] = source;
    if (!item?.local || item.home || (item.kind !== 'page' && item.kind !== 'section')) return;
    data.set(MIME, new vscode.DataTransferItem(item));
  }

  /**
   * Soltar: em cima de uma página, fica antes dela; em cima de uma seção, vai para o fim dela (seção sobre seção:
   * antes dela); no vazio ou no nome do site, no fim do menu, fora de seção. Página de fora do menu entra nele.
   */
  async handleDrop(target: DocsItem | undefined, data: vscode.DataTransfer) {
    const item = data.get(MIME)?.value as DocsItem | undefined;
    if (!item || item === target) return;
    if (target && (!target.local || target.kind === 'notInNav' || target.outside || target.kind === 'link')) return;
    if (target?.kind === 'page' && target.home) return void vscode.window.showInformationMessage(vscode.l10n.t('The home page always stays first.'));
    if (item.kind === 'section' && target?.trail && target.trail.join('\u0000').startsWith(item.trail!.join('\u0000'))) return;
    if (item.outside) {
      // De fora do menu: entra onde soltou
      const site = this.siteOf(item);
      if (!site) return;
      const yml = await this.readYml(site.mkdocs);
      const nav = readNav(yml) ?? [];
      const entry: NavItem = { kind: 'page', path: item.path! };
      const place = target && target.kind !== 'site' ? this.placeOf(nav, target) : undefined;
      if (target?.kind === 'section' && place) (place.list[place.index] as Extract<NavItem, { kind: 'section' }>).children.push(entry);
      else if (place) place.list.splice(place.index, 0, entry);
      else nav.push(entry);
      const undo = await this.change(vscode.l10n.t('add "{0}" to the menu', item.label), [site.mkdocs], () => writeText(site.mkdocs, writeNav(yml, nav)));
      return this.done(vscode.l10n.t('"{0}" now appears in the menu of the site.', item.label), undo);
    }
    if (!target || target.kind === 'site') return this.move(item, { into: [] });
    if (target.kind === 'section' && item.kind === 'page') return this.move(item, { into: target.trail! });
    return this.move(item, { before: target });
  }
}

/** Primeiro item do menu é a página inicial. */
const isHome = (item: NavItem | undefined) => item?.kind === 'page' && /^(index|readme)\.md$/i.test(item.path);

/** Tira as páginas do menu (onde estiverem); diz se tirou alguma. */
function removePages(nav: NavItem[], paths: Set<string>): boolean {
  let removed = false;
  for (let i = nav.length - 1; i >= 0; i--) {
    const item = nav[i];
    if (item.kind === 'page' && paths.has(item.path)) {
      nav.splice(i, 1);
      removed = true;
    } else if (item.kind === 'section' && removePages(item.children, paths)) removed = true;
  }
  return removed;
}

function descendants(item: DocsItem): DocsItem[] {
  return item.children.flatMap(child => [child, ...descendants(child)]);
}

/** "A, B e C". */
function joinNames(names: string[]): string {
  if (names.length < 2) return names.join('');
  return vscode.l10n.t('{0} and {1}', names.slice(0, -1).join(', '), names[names.length - 1]);
}

async function closeTabs(uris: vscode.Uri[]) {
  const keys = new Set(uris.map(u => u.toString()));
  const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(tab => {
    const input = tab.input;
    return (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) && keys.has(input.uri.toString());
  });
  if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
}

/** Para a lixeira; sem lixeira (navegador, alguns Linux), apagado (o "Desfazer" guarda o conteúdo). */
async function trash(uri: vscode.Uri) {
  await vscode.workspace.fs.delete(uri, { useTrash: true }).then(undefined, () => vscode.workspace.fs.delete(uri).then(undefined, () => {}));
}

async function removeIfEmpty(dir: vscode.Uri) {
  const entries = await vscode.workspace.fs.readDirectory(dir).then(e => e, () => undefined);
  if (entries && !entries.length) await vscode.workspace.fs.delete(dir, { useTrash: false }).then(undefined, () => {});
}

async function readBytes(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return new TextEncoder().encode(open.getText());
  return vscode.workspace.fs.readFile(uri).then(
    data => data,
    () => undefined,
  );
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const data = await readBytes(uri);
  return data && new TextDecoder().decode(data);
}

/** Grava pelo documento aberto, se houver (o editor acompanha e não fica "alterado"); senão direto no disco. */
async function writeText(uri: vscode.Uri, text: string) {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(0, 0, open.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit);
    await open.save();
    return;
  }
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

