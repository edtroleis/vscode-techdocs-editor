import type { CrepeConfig, CrepeFeature } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import { deleteSelection, lift, setBlockType, wrapIn } from '@milkdown/kit/prose/commands';
import { redo, undo } from '@milkdown/kit/prose/history';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { deleteTable } from '@milkdown/kit/prose/tables';
import { NodeSelection } from '@milkdown/kit/prose/state';
import type { Command, EditorState } from '@milkdown/kit/prose/state';
import { externalHistoryCtx } from './externalHistory';
import { DIAGRAM_ICON, icon } from './icons';
import { FILE_ICON, pickFile } from './attachFile';
import { openDiagramGallery } from './diagramGallery';
import { inlineCodeTyping, toggleInlineCodeTyping } from './inlineCodeTyping';
import { ICON_PAGE_KIND, type PageKinds } from './pageKinds';
import { openBarMenu, openPageKindsMenu, openTechdocsMenu, TECHDOCS_ICON } from './techdocsMenu';
import type { EditorText } from './labels';


const UNDO_ICON = icon(
  'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
);
const PLUS_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const CHEVRON_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>';
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const REDO_ICON = icon(
  'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
);

/** Algum nó acima do cursor tem o tipo `name`. */
const inside = (state: EditorState, name: string) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === name) return true;
  }
  return false;
};

const inBlockquote = (state: EditorState) => inside(state, 'blockquote');
const inTable = (state: EditorState) => inside(state, 'table');
const inCodeBlock = (state: EditorState) =>
  inside(state, 'code_block') ||
  (state.selection instanceof NodeSelection && state.selection.node.type.name === 'code_block');

type ListKind = 'bullet' | 'ordered' | 'task';

/** Tipo da lista em que o cursor está (a mais interna), se estiver numa. */
function currentList(state: EditorState): ListKind | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'ordered_list') return 'ordered';
    if (name === 'bullet_list') {
      // Lista de tarefas é uma lista com marcador cujos itens têm "checked"
      const item = depth < $from.depth ? $from.node(depth + 1) : undefined;
      return item?.attrs.checked === null || item?.attrs.checked === undefined ? 'bullet' : 'task';
    }
  }
  return undefined;
}

/** Linha horizontal selecionada (clicar sobre ela a seleciona). */
const hrSelected = (state: EditorState) =>
  state.selection instanceof NodeSelection && state.selection.node.type.name === 'hr';

const run = (ctx: Ctx, command: Command) => {
  const view = ctx.get(editorViewCtx);
  command(view.state, view.dispatch);
  view.focus();
};

const stateOf = (ctx: Ctx) => ctx.get(editorViewCtx).state;

// Tipo do builder da barra do Crepe (não exportado pelo pacote)
type TopBarBuilder = Parameters<
  NonNullable<NonNullable<NonNullable<CrepeConfig['featureConfigs']>[CrepeFeature.TopBar]>['buildTopBar']>
>[0];
type TopBarEntry = TopBarBuilder extends { getGroup: (key: string) => { group: { items: Array<infer I> } } }
  ? I
  : never;
/** Um botão da barra, sem a chave (a chave vai no addItem). */
type TopBarItem = Omit<TopBarEntry, 'key'>;

/**
 * Ajustes na barra fixa do editor. O padrão do Crepe só adiciona: não havia como desfazer uma
 * lista, citação, tabela ou bloco de código criados sem querer (clicar de novo criava outro). Aqui
 * cada botão alterna, como no Word/Confluence, e mostra quando está ativo:
 * - listas: dentro da lista do mesmo tipo, tira o item da lista; dentro de outro tipo, troca o tipo;
 * - citação: dentro de uma citação, tira um nível;
 * - linha horizontal: com a linha selecionada, remove;
 * - tabela: com o cursor na tabela, remove a tabela;
 * - bloco de código: com o cursor no bloco, volta a ser parágrafo.
 * Também Desfazer/Refazer (antes só por Ctrl+Z / Ctrl+Y) e código no texto sem seleção valendo
 * para tudo o que for digitado (ver inlineCodeTyping.ts).
 */
export function buildTopBar(builder: TopBarBuilder, text: EditorText, pageKinds?: PageKinds, canAttach = false) {
  const formatting = builder.getGroup('formatting');
  const inlineCode = (formatting.group.items as Array<TopBarEntry>).find(i => i.key === 'code');
  if (inlineCode) {
    const isActive = inlineCode.active;
    const toggle = inlineCode.onRun;
    inlineCode.active = (ctx: Ctx) => inlineCodeTyping(stateOf(ctx)) || isActive(ctx);
    inlineCode.onRun = (ctx: Ctx) => {
      const view = ctx.get(editorViewCtx);
      // Sem seleção: liga/desliga "digitar como código" (o padrão só valia para uma letra)
      if (view.state.selection.empty) {
        toggleInlineCodeTyping(view);
        view.focus();
      } else {
        toggle?.(ctx);
      }
    };
  }

  const lists = builder.getGroup('list');
  const [bullet, ordered, task] = lists.group.items as TopBarItem[];
  const listButton = (kind: ListKind, original: TopBarItem) => ({
    icon: original.icon,
    active: (ctx: Ctx) => currentList(stateOf(ctx)) === kind,
    onRun: (ctx: Ctx) => {
      const state = stateOf(ctx);
      const current = currentList(state);
      if (current) run(ctx, liftListItem(state.schema.nodes.list_item));
      if (current !== kind) original.onRun?.(ctx);
      ctx.get(editorViewCtx).focus();
    },
  });
  lists
    .clear()
    .addItem('bullet-list', listButton('bullet', bullet))
    .addItem('ordered-list', listButton('ordered', ordered))
    .addItem('task-list', listButton('task', task));

  const insert = builder.getGroup('insert');
  const insertItems = insert.group.items as Array<TopBarEntry>;
  const link = insertItems.find(i => i.key === 'link');
  const image = insertItems.find(i => i.key === 'image');
  const table = insertItems.find(i => i.key === 'table');
  if (table) {
    table.active = (ctx: Ctx) => inTable(stateOf(ctx));
    const addTable = table.onRun;
    table.onRun = (ctx: Ctx) => {
      if (inTable(stateOf(ctx))) run(ctx, deleteTable);
      else addTable?.(ctx);
    };
  }

  const block = builder.getGroup('block');
  const codeBlock = (block.group.items as Array<TopBarEntry>).find(i => i.key === 'code-block');
  if (codeBlock) {
    codeBlock.active = (ctx: Ctx) => inCodeBlock(stateOf(ctx));
    const addCode = codeBlock.onRun;
    codeBlock.onRun = (ctx: Ctx) => {
      const state = stateOf(ctx);
      if (inCodeBlock(state)) run(ctx, setBlockType(state.schema.nodes.paragraph));
      else addCode?.(ctx);
    };
  }

  const [quote, hr] = builder.getGroup('more').group.items as TopBarItem[];
  const quoteItem: TopBarItem = {
    icon: quote.icon,
    active: (ctx: Ctx) => inBlockquote(stateOf(ctx)),
    onRun: (ctx: Ctx) => {
      const state = stateOf(ctx);
      run(ctx, inBlockquote(state) ? lift : wrapIn(state.schema.nodes.blockquote));
    },
  };
  const hrItem: TopBarItem = {
    icon: hr.icon,
    active: (ctx: Ctx) => hrSelected(stateOf(ctx)),
    onRun: (ctx: Ctx) => {
      if (hrSelected(stateOf(ctx))) run(ctx, deleteSelection);
      else hr.onRun?.(ctx);
    },
  };
  const diagramItem: TopBarItem = { icon: DIAGRAM_ICON, active: () => false, onRun: openDiagramGallery };

  // "+ Inserir" (opção 3 do protótipo): o que entra na página, com nomes, num menu; marcado quando o cursor está
  // num deles (tabela, citação, código, linha), e o mesmo item tira
  const fileItem: TopBarItem | undefined = canAttach ? { icon: FILE_ICON, active: () => false, onRun: pickFile } : undefined;
  const inserts = [
    [text.image, image],
    [text.file, fileItem],
    [text.table, table],
    [text.codeBlock, codeBlock],
    [text.diagram.label, diagramItem],
    [text.quote, quoteItem],
    [text.divider, hrItem],
  ].filter((entry): entry is [string, TopBarItem] => Boolean(entry[1]));
  const insertButton: TopBarItem = {
    icon: `${PLUS_ICON}<span class="td-insert-label">${escapeHtml(text.topBar.insert)}</span>${CHEVRON_ICON}`,
    active: (ctx: Ctx) => inserts.some(([, item]) => item.active(ctx)),
    onRun: (ctx: Ctx) =>
      openBarMenu(ctx, text.topBar.insert, () =>
        inserts.map(([label, item]) => {
          const on = item.active(ctx);
          return { icon: item.icon, label, checked: on || undefined, run: () => item.onRun?.(ctx) };
        }),
      ),
  };

  // A barra, na ordem do protótipo: Desfazer/Refazer · título · texto · listas · + Inserir · tipos de página e TechDocs
  const heading = builder.getGroup('heading').group.items as Array<TopBarEntry>;
  const formattingItems = formatting.group.items as Array<TopBarEntry>;
  const listItems = lists.group.items as Array<TopBarEntry>;
  const add = (group: ReturnType<TopBarBuilder['addGroup']>, items: TopBarEntry[]) => {
    for (const { key, ...item } of items) group.addItem(key, item);
  };
  builder.clear();
  builder
    .addGroup('history', 'Histórico')
    .addItem('undo', {
      icon: UNDO_ICON,
      active: () => false,
      onRun: (ctx: Ctx) => {
        const external = ctx.get(externalHistoryCtx);
        if (external) external.undo();
        else run(ctx, undo);
      },
    })
    .addItem('redo', {
      icon: REDO_ICON,
      active: () => false,
      onRun: (ctx: Ctx) => {
        const external = ctx.get(externalHistoryCtx);
        if (external) external.redo();
        else run(ctx, redo);
      },
    });;
  add(builder.addGroup('heading', 'Heading'), heading);
  const textGroup = builder.addGroup('formatting', 'Formatting');
  add(textGroup, formattingItems);
  if (link) textGroup.addItem('link', link);
  add(builder.addGroup('list', 'List'), listItems);
  builder.addGroup('insert', text.topBar.insert).addItem('insert', insertButton);
  const techdocs = builder.addGroup('techdocs', text.components.group);
  // Tipos de página (Runbook, Tutorial…), quando o site tem: um botão só deles, antes dos componentes
  if (pageKinds?.kinds.length) techdocs.addItem('page-kinds', { icon: ICON_PAGE_KIND, active: () => false, onRun: openPageKindsMenu });
  techdocs.addItem('techdocs', { icon: TECHDOCS_ICON, active: () => false, onRun: openTechdocsMenu });
}
