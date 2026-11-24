import { createSlice, type Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Node, Schema } from '@milkdown/kit/prose/model';
import { type EditorState, Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils';
import { type AdmonitionHeader, formatAdmonition, formatTab, kindStyle, type Marker, parseAdmonition, parseTab } from './techdocsHeaders';

/**
 * Os componentes do TechDocs no editor visual (spec 01, M1): avisos (`!!!`), recolhíveis (`???`, `???+`) e abas
 * (`===`). O núcleo (`toEditor`) entrega cada um como uma citação com o cabeçalho em código na primeira linha; aqui
 * essa citação vira um nó próprio, desenhado como no Backstage, e volta exatamente para a mesma citação ao salvar
 * (o núcleo a devolve ao formato do MkDocs). Abas seguidas formam um grupo: a faixa com os títulos é uma decoração
 * e só a aba escolhida aparece.
 */

/** Os tipos do menu Tipo ▾, na ordem do protótipo (os outros tipos do Material continuam funcionando). */
export const MENU_KINDS = ['note', 'tip', 'info', 'success', 'warning', 'danger', 'question', 'example', 'abstract'] as const;
export type MenuKind = (typeof MENU_KINDS)[number];

export type CollapseMode = 'open' | 'closed' | 'expanded';
const MARKER_OF: Record<CollapseMode, Marker> = { open: '!!!', closed: '???', expanded: '???+' };
const MODE_OF: Record<Marker, CollapseMode> = { '!!!': 'open', '???': 'closed', '???+': 'expanded' };

export type ComponentsText = {
  /** Grupo do menu "/" e os itens. */
  group: string;
  admonition: string;
  collapsible: string;
  tabs: string;
  cards: string;
  /** Barra dos cards: + Card e o card novo. */
  card: { add: string; title: string; text: string };
  /** Barra do aviso. */
  kind: string;
  kindTitle: string;
  kinds: Record<MenuKind, string>;
  collapse: string;
  collapseTitle: string;
  collapseModes: Record<CollapseMode, string>;
  remove: string;
  /** Abas. */
  tab: {
    name: (n: number) => string;
    add: string;
    menuTitle: string;
    rename: string;
    moveLeft: string;
    moveRight: string;
    addAfter: string;
    remove: string;
  };
};

export const componentsCtx = createSlice<ComponentsText>(
  {
    group: 'TechDocs',
    admonition: 'Admonition',
    collapsible: 'Collapsible',
    tabs: 'Tabs',
    cards: 'Cards',
    card: { add: '+ Card', title: 'Card title', text: 'A short description of the card.' },
    kind: 'Type',
    kindTitle: 'Admonition type',
    kinds: {
      note: 'Note',
      tip: 'Tip',
      info: 'Info',
      success: 'Success',
      warning: 'Warning',
      danger: 'Danger',
      question: 'Question',
      example: 'Example',
      abstract: 'Abstract',
    },
    collapse: 'Collapsible',
    collapseTitle: 'Collapsible',
    collapseModes: { open: 'Always open', closed: 'Collapsible, starts closed', expanded: 'Collapsible, starts open' },
    remove: 'Delete',
    tab: {
      name: n => `Tab ${n}`,
      add: 'New tab',
      menuTitle: 'Tab',
      rename: 'Rename tab',
      moveLeft: 'Move left',
      moveRight: 'Move right',
      addAfter: 'New tab after this one',
      remove: 'Delete tab',
    },
  },
  'techdocsComponents',
);

// ---------------------------------------------------------------------------------------------------------------
// Markdown: a citação com o cabeçalho em código vira o nó (só na leitura; na escrita o nó volta a ser a citação)

/** O cabeçalho dos cards do Material (`<div class="grid cards" markdown>`), guardado como está escrito. */
export const CARDS_HEADER = /^<div\s+class="grid cards"[^>]*\smarkdown(="[^"]*")?[^>]*>$/;
export const DEFAULT_CARDS_HEADER = '<div class="grid cards" markdown>';

type Md = { type: string; children?: Md[]; value?: string; [key: string]: unknown };

function quotedHeader(node: Md): string | undefined {
  const first = node.children?.[0];
  if (first?.type !== 'paragraph' || first.children?.length !== 1) return undefined;
  const code = first.children[0];
  return code.type === 'inlineCode' ? code.value : undefined;
}

function transform(node: Md) {
  node.children?.forEach(transform);
  if (node.type !== 'blockquote') return;
  const header = quotedHeader(node);
  if (header === undefined) return;
  const body = node.children!.slice(1);
  if (!body.length) body.push({ type: 'paragraph', children: [] });
  const admonition = parseAdmonition(header);
  if (admonition) {
    const { marker, kind, extra, title } = admonition;
    Object.assign(node, {
      type: 'tdAdmonition',
      marker,
      kind,
      extra,
      quotedEmpty: title === '',
      children: [{ type: 'tdTitle', value: title ?? '' }, ...body],
    });
    return;
  }
  if (CARDS_HEADER.test(header)) {
    Object.assign(node, { type: 'tdCards', header, children: body });
    return;
  }
  const tab = parseTab(header);
  if (tab) Object.assign(node, { type: 'tdTab', selected: tab.selected, title: tab.title, children: body });
}

export const remarkTechdocsComponents = $remark('remarkTechdocsComponents', () => () => (tree: unknown) => {
  transform(tree as Md);
});

/** O corpo vazio (um parágrafo vazio) não vai para o arquivo: `!!! tip` sozinho volta sozinho. */
const emptyBody = (nodes: Node[]) => nodes.length === 1 && nodes[0].type.name === 'paragraph' && nodes[0].content.size === 0;

/** O cabeçalho do aviso, com o título que está escrito agora. */
export function admonitionHeader(node: Node): string {
  const title = node.firstChild?.type.name === 'td_title' ? node.firstChild.textContent : '';
  const { marker, kind, extra, quotedEmpty } = node.attrs as { marker: Marker; kind: string; extra: string; quotedEmpty: boolean };
  return formatAdmonition({ marker, kind, extra, title: title || (quotedEmpty ? '' : null) });
}

function attrsOf(h: AdmonitionHeader) {
  return { marker: h.marker, kind: h.kind, extra: h.extra, quotedEmpty: h.title === '' };
}

/** O cabeçalho em código de uma citação colada (`<blockquote><p><code>!!! tip</code></p>…`). */
function domHeader(dom: HTMLElement): string | undefined {
  const first = dom.firstElementChild;
  if (first?.tagName !== 'P' || first.childNodes.length !== 1) return undefined;
  const code = first.firstChild as HTMLElement;
  return code.nodeType === 1 && code.tagName === 'CODE' ? (code.textContent ?? '') : undefined;
}

/** O conteúdo da citação colada sem a linha do cabeçalho (e com o título, no aviso). */
function bodyOf(dom: HTMLElement, title?: string): HTMLElement {
  const wrap = dom.ownerDocument.createElement('div');
  if (title !== undefined) {
    const t = dom.ownerDocument.createElement('div');
    t.className = 'td-title';
    t.textContent = title;
    wrap.append(t);
  }
  for (const child of [...dom.childNodes].slice(1)) wrap.append(child.cloneNode(true));
  return wrap;
}

export const titleSchema = $nodeSchema('td_title', () => ({
  content: 'text*',
  marks: '',
  defining: true,
  parseDOM: [{ tag: 'div.td-title' }],
  toDOM: () => ['div', { class: 'td-title' }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'tdTitle',
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  // O título vai no cabeçalho do aviso (ver o aviso)
  toMarkdown: { match: node => node.type.name === 'td_title', runner: () => undefined },
}));

export const admonitionSchema = $nodeSchema('td_admonition', () => ({
  content: 'td_title block+',
  group: 'block',
  defining: true,
  attrs: { marker: { default: '!!!' }, kind: { default: 'note' }, extra: { default: '' }, quotedEmpty: { default: false } },
  parseDOM: [
    {
      tag: 'div[data-td-admonition]',
      getAttrs: dom => {
        const d = (dom as HTMLElement).dataset;
        return { marker: d.marker ?? '!!!', kind: d.kind ?? 'note', extra: d.extra ?? '', quotedEmpty: d.quotedEmpty === 'true' };
      },
    },
    {
      tag: 'blockquote',
      priority: 60,
      getAttrs: dom => {
        const header = domHeader(dom as HTMLElement);
        const h = header === undefined ? undefined : parseAdmonition(header);
        return h ? attrsOf(h) : false;
      },
      contentElement: dom => bodyOf(dom as HTMLElement, parseAdmonition(domHeader(dom as HTMLElement) ?? '')?.title ?? ''),
    },
  ],
  toDOM: node => [
    'div',
    {
      class: `td-admonition td-kind-${kindStyle(node.attrs.kind)}`,
      'data-td-admonition': '',
      'data-marker': node.attrs.marker,
      'data-kind': node.attrs.kind,
      'data-extra': node.attrs.extra,
      'data-quoted-empty': String(node.attrs.quotedEmpty),
      ...(node.attrs.marker === '!!!' ? {} : { 'data-collapsible': MODE_OF[node.attrs.marker as Marker] }),
    },
    0,
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'tdAdmonition',
    runner: (state, node, type) => {
      const { marker, kind, extra, quotedEmpty } = node as Md;
      state.openNode(type, { marker, kind, extra, quotedEmpty }).next(node.children).closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'td_admonition',
    runner: (state, node) => {
      state.openNode('blockquote').openNode('paragraph').addNode('inlineCode', undefined, admonitionHeader(node)).closeNode();
      const body: Node[] = [];
      node.forEach((child, _, i) => i > 0 && body.push(child));
      if (!emptyBody(body)) body.forEach(child => state.next(child));
      state.closeNode();
    },
  },
}));

export const tabSchema = $nodeSchema('td_tab', () => ({
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: { title: { default: '' }, selected: { default: false } },
  parseDOM: [
    {
      tag: 'div[data-td-tab]',
      getAttrs: dom => ({ title: (dom as HTMLElement).dataset.tdTab ?? '', selected: (dom as HTMLElement).dataset.selected === 'true' }),
    },
    {
      tag: 'blockquote',
      priority: 60,
      getAttrs: dom => {
        const header = domHeader(dom as HTMLElement);
        return (header === undefined ? undefined : parseTab(header)) ?? false;
      },
      contentElement: dom => bodyOf(dom as HTMLElement),
    },
  ],
  toDOM: node => ['div', { class: 'td-tab', 'data-td-tab': node.attrs.title, 'data-selected': String(node.attrs.selected) }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'tdTab',
    runner: (state, node, type) => {
      state.openNode(type, { title: node.title, selected: node.selected }).next(node.children).closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'td_tab',
    runner: (state, node) => {
      const header = formatTab({ title: node.attrs.title, selected: node.attrs.selected });
      state.openNode('blockquote').openNode('paragraph').addNode('inlineCode', undefined, header).closeNode();
      const body: Node[] = [];
      node.forEach(child => body.push(child));
      if (!emptyBody(body)) body.forEach(child => state.next(child));
      state.closeNode();
    },
  },
}));

export const cardsSchema = $nodeSchema('td_cards', () => ({
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: { header: { default: DEFAULT_CARDS_HEADER } },
  parseDOM: [
    { tag: 'div[data-td-cards]', getAttrs: dom => ({ header: (dom as HTMLElement).dataset.tdCards || DEFAULT_CARDS_HEADER }) },
    {
      tag: 'blockquote',
      priority: 60,
      getAttrs: dom => {
        const header = domHeader(dom as HTMLElement);
        return header !== undefined && CARDS_HEADER.test(header) ? { header } : false;
      },
      contentElement: dom => bodyOf(dom as HTMLElement),
    },
  ],
  toDOM: node => ['div', { class: 'td-cards', 'data-td-cards': node.attrs.header }, 0],
  parseMarkdown: {
    match: ({ type }) => type === 'tdCards',
    runner: (state, node, type) => {
      state.openNode(type, { header: node.header }).next(node.children).closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'td_cards',
    runner: (state, node) => {
      state.openNode('blockquote').openNode('paragraph').addNode('inlineCode', undefined, node.attrs.header).closeNode();
      const body: Node[] = [];
      node.forEach(child => body.push(child));
      if (!emptyBody(body)) body.forEach(child => state.next(child));
      state.closeNode();
    },
  },
}));

/** Um card como os da documentação do Material: o título em negrito, a linha e a descrição. */
export function newCard(schema: Schema, text: ComponentsText['card'], like?: Node): Node {
  const { nodes, marks } = schema;
  const item = like?.type ?? nodes.list_item;
  return item.create({ ...(like?.attrs ?? {}), spread: true }, [
    nodes.paragraph.create(null, schema.text(text.title, [marks.strong.create()])),
    nodes.hr.create(),
    nodes.paragraph.create(null, schema.text(text.text)),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// Inserir pelo menu "/"

export type ComponentKind = 'admonition' | 'collapsible' | 'tabs' | 'cards';

/** Troca o parágrafo do cursor (vazio, o "/" já saiu) pelo componente, com o cursor no lugar de escrever. */
export function insertComponent(ctx: Ctx, kind: ComponentKind) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { schema } = state;
  const { $from } = state.selection;
  const paragraph = () => schema.nodes.paragraph.create();
  let node: Node;
  if (kind === 'cards') {
    const text = ctx.get(componentsCtx).card;
    const list = schema.nodes.bullet_list.create({ spread: true }, [newCard(schema, text), newCard(schema, text)]);
    const from = $from.depth ? $from.before() : $from.pos;
    const to = $from.depth ? $from.after() : $from.pos;
    const tr = state.tr.replaceWith(from, to, schema.nodes.td_cards.create(null, list));
    // O título do primeiro card selecionado, pronto para trocar
    const start = from + 4;
    tr.setSelection(TextSelection.create(tr.doc, start, start + text.title.length));
    view.dispatch(tr.scrollIntoView());
  } else if (kind === 'tabs') {
    const name = ctx.get(componentsCtx).tab.name;
    node = schema.nodes.td_tab.create({ title: name(1) }, paragraph());
    const second = schema.nodes.td_tab.create({ title: name(2) }, paragraph());
    const from = $from.depth ? $from.before() : $from.pos;
    const to = $from.depth ? $from.after() : $from.pos;
    const tr = state.tr.replaceWith(from, to, [node, second]);
    tr.setSelection(TextSelection.near(tr.doc.resolve(from + 2)));
    view.dispatch(tr.scrollIntoView());
  } else {
    node = schema.nodes.td_admonition.create({ marker: kind === 'collapsible' ? '???' : '!!!', kind: 'note' }, [
      schema.nodes.td_title.create(),
      paragraph(),
    ]);
    const from = $from.depth ? $from.before() : $from.pos;
    const to = $from.depth ? $from.after() : $from.pos;
    const tr = state.tr.replaceWith(from, to, node);
    tr.setSelection(TextSelection.create(tr.doc, from + 2));
    view.dispatch(tr.scrollIntoView());
  }
  view.focus();
}

// ---------------------------------------------------------------------------------------------------------------
// Abas: grupos de abas seguidas, a faixa com os títulos e a aba escolhida

type Tab = { pos: number; node: Node };
type Group = { tabs: Tab[] };

function groups(doc: Node): Group[] {
  const out: Group[] = [];
  const scan = (parent: Node, start: number) => {
    let group: Group | undefined;
    parent.forEach((child, offset) => {
      const pos = start + offset;
      if (child.type.name === 'td_tab') (group ??= { tabs: [] }).tabs.push({ pos, node: child });
      else if (group) {
        out.push(group);
        group = undefined;
      }
      if (child.isBlock && !child.isTextblock && !child.isAtom) scan(child, pos + 1);
    });
    if (group) out.push(group);
  };
  scan(doc, 0);
  return out;
}

type TabsState = { active: Map<number, number>; decorations: DecorationSet };
type TabsMeta = { start: number; index: number };

const key = new PluginKey<TabsState>('techdocs-components');

/** A aba com o cursor dentro (a de dentro, com abas dentro de abas). */
function tabWithCursor(group: Group, state: EditorState) {
  const { from } = state.selection;
  return group.tabs.findIndex(t => from > t.pos && from < t.pos + t.node.nodeSize);
}

function activeIndex(group: Group, active: Map<number, number>) {
  const saved = active.get(group.tabs[0].pos);
  if (saved !== undefined && saved < group.tabs.length) return saved;
  const selected = group.tabs.findIndex(t => t.node.attrs.selected);
  return selected >= 0 ? selected : 0;
}

class Tabs {
  private menu?: HTMLElement;

  constructor(
    private readonly view: () => EditorView | undefined,
    private readonly text: () => ComponentsText,
  ) {}

  /** A faixa com os títulos do grupo; `start` é a posição da primeira aba. */
  strip(group: Group, active: number): HTMLElement {
    const text = this.text().tab;
    const strip = document.createElement('div');
    strip.className = 'td-tabs';
    strip.contentEditable = 'false';
    strip.setAttribute('role', 'tablist');
    strip.dataset.start = String(group.tabs[0].pos);
    group.tabs.forEach((tab, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(i === active));
      button.dataset.index = String(i);
      button.textContent = tab.node.attrs.title || text.name(i + 1);
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => this.select(strip, i));
      button.addEventListener('dblclick', () => this.rename(strip, i));
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        this.openMenu(strip, i, button);
      });
      button.addEventListener('keydown', event => {
        if (event.key === 'F2') this.rename(strip, i);
        else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          this.openMenu(strip, i, button);
        }
      });
      strip.append(button);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'td-tab-add';
    add.textContent = '+';
    add.title = text.add;
    add.setAttribute('aria-label', text.add);
    add.addEventListener('mousedown', event => event.preventDefault());
    add.addEventListener('click', () => this.add(strip, group.tabs.length - 1));
    strip.append(add);
    return strip;
  }

  /** O grupo da faixa, lido de novo do documento (as posições mudam a cada edição). */
  private group(strip: HTMLElement): Group | undefined {
    const view = this.view();
    if (!view) return undefined;
    const start = Number(strip.dataset.start);
    return groups(view.state.doc).find(g => g.tabs[0].pos === start);
  }

  private select(strip: HTMLElement, index: number) {
    const view = this.view();
    const group = this.group(strip);
    const tab = group?.tabs[index];
    if (!view || !group || !tab) return;
    const tr = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(tab.pos + 1)));
    tr.setMeta(key, { start: group.tabs[0].pos, index } satisfies TabsMeta);
    view.dispatch(tr);
    view.focus();
  }

  rename(strip: HTMLElement, index: number) {
    const view = this.view();
    const tab = this.group(strip)?.tabs[index];
    const button = strip.querySelector<HTMLButtonElement>(`button[data-index="${index}"]`);
    if (!view?.editable || !tab || !button) return;
    const input = document.createElement('input');
    input.className = 'td-tab-rename';
    input.value = tab.node.attrs.title;
    input.setAttribute('aria-label', this.text().tab.rename);
    input.size = Math.max(6, input.value.length + 1);
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const title = input.value.replace(/"/g, "'").trim();
      input.replaceWith(button);
      const now = this.group(strip)?.tabs[index];
      if (save && now && title && title !== now.node.attrs.title)
        view.dispatch(view.state.tr.setNodeMarkup(now.pos, undefined, { ...now.node.attrs, title }));
      view.focus();
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('input', () => (input.size = Math.max(6, input.value.length + 1)));
    input.addEventListener('blur', () => finish(true));
    button.replaceWith(input);
    input.focus();
    input.select();
  }

  /** Aba nova depois de `index`, com o nome pronto para trocar. */
  private add(strip: HTMLElement, index: number) {
    const view = this.view();
    const group = this.group(strip);
    if (!view?.editable || !group) return;
    const { schema } = view.state;
    const after = group.tabs[index];
    const title = this.text().tab.name(group.tabs.length + 1);
    const pos = after.pos + after.node.nodeSize;
    const tr = view.state.tr.insert(pos, schema.nodes.td_tab.create({ title }, schema.nodes.paragraph.create()));
    tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
    tr.setMeta(key, { start: group.tabs[0].pos, index: index + 1 } satisfies TabsMeta);
    view.dispatch(tr);
    const fresh = view.dom.querySelector<HTMLElement>(`.td-tabs[data-start="${group.tabs[0].pos}"]`);
    if (fresh) this.rename(fresh, index + 1);
  }

  private move(strip: HTMLElement, index: number, by: -1 | 1) {
    const view = this.view();
    const group = this.group(strip);
    const a = group?.tabs[Math.min(index, index + by)];
    const b = group?.tabs[Math.max(index, index + by)];
    if (!view?.editable || !group || !a || !b || a === b) return;
    const tr = view.state.tr.replaceWith(a.pos, b.pos + b.node.nodeSize, [b.node, a.node]);
    const moved = by < 0 ? a.pos : a.pos + b.node.nodeSize;
    tr.setSelection(Selection.near(tr.doc.resolve(moved + 1)));
    tr.setMeta(key, { start: group.tabs[0].pos, index: index + by } satisfies TabsMeta);
    view.dispatch(tr);
    view.focus();
  }

  private remove(strip: HTMLElement, index: number) {
    const view = this.view();
    const group = this.group(strip);
    const tab = group?.tabs[index];
    if (!view?.editable || !group || !tab) return;
    const tr = view.state.tr.delete(tab.pos, tab.pos + tab.node.nodeSize);
    const next = Math.max(0, index - 1);
    if (group.tabs.length > 1) {
      const target = index === 0 ? tab.pos : group.tabs[next].pos;
      tr.setSelection(Selection.near(tr.doc.resolve(target + 1)));
      tr.setMeta(key, { start: group.tabs[0].pos, index: next } satisfies TabsMeta);
    }
    view.dispatch(tr);
    view.focus();
  }

  private openMenu(strip: HTMLElement, index: number, button: HTMLElement) {
    this.closeMenu();
    const text = this.text().tab;
    const count = this.group(strip)?.tabs.length ?? 0;
    const items: [string, () => void, boolean?][] = [
      [text.rename, () => this.rename(strip, index)],
      [text.moveLeft, () => this.move(strip, index, -1), index === 0],
      [text.moveRight, () => this.move(strip, index, 1), index >= count - 1],
      [text.addAfter, () => this.add(strip, index)],
      [text.remove, () => this.remove(strip, index)],
    ];
    const menu = popup(button, text.menuTitle, 'td-tab-menu');
    for (const [label, action, disabled] of items) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = label;
      item.disabled = !!disabled;
      if (label === text.remove) item.classList.add('td-danger');
      item.addEventListener('click', () => {
        this.closeMenu();
        action();
      });
      menu.items.append(item);
    }
    this.menu = menu.place();
    this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && this.menu?.contains(event.target as globalThis.Node)) return;
      this.closeMenu();
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = undefined;
  }
}

/** Um menu flutuante (mesmo visual dos menus do fluxograma) embaixo de `anchor`. */
function popup(anchor: HTMLElement, title: string, className: string) {
  const menu = document.createElement('div');
  menu.className = `mermaid-bar-menu ${className}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', title);
  menu.addEventListener('pointerdown', event => {
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
  });
  const heading = document.createElement('div');
  heading.className = 'mermaid-bar-menu-title';
  heading.textContent = title;
  const items = document.createElement('div');
  items.className = 'mermaid-bar-menu-items';
  menu.append(heading, items);
  return {
    items,
    place: () => {
      (anchor.closest('.milkdown') ?? document.body).append(menu);
      const box = anchor.getBoundingClientRect();
      const { width, height } = menu.getBoundingClientRect();
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      const top = box.bottom + 4 + height <= window.innerHeight - 8 ? box.bottom + 4 : Math.max(8, box.top - height - 4);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      return menu;
    },
  };
}

function decorate(doc: Node, active: Map<number, number>, tabs: Tabs): DecorationSet {
  const decorations: Decoration[] = [];
  for (const group of groups(doc)) {
    const current = activeIndex(group, active);
    const titles = group.tabs.map(t => t.node.attrs.title).join('\u0001');
    decorations.push(
      Decoration.widget(group.tabs[0].pos, () => tabs.strip(group, current), {
        side: -1,
        key: `td-tabs:${group.tabs[0].pos}:${current}:${titles}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
    group.tabs.forEach((tab, i) => {
      const classes = ['td-tab-in-group', i === current ? 'td-tab-active' : 'td-tab-hidden'];
      decorations.push(Decoration.node(tab.pos, tab.pos + tab.node.nodeSize, { class: classes.join(' ') }));
    });
  }
  // O título vazio mostra o que o Backstage mostra no lugar (o nome do tipo)
  doc.descendants((node, pos) => {
    if (node.type.name !== 'td_admonition') return true;
    const title = node.firstChild;
    if (title && title.content.size === 0) {
      const kind = node.attrs.kind as string;
      const shown = node.attrs.quotedEmpty ? '' : kind.charAt(0).toUpperCase() + kind.slice(1);
      decorations.push(Decoration.node(pos + 1, pos + 1 + title.nodeSize, { class: 'td-title-empty', 'data-placeholder': shown }));
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

// ---------------------------------------------------------------------------------------------------------------
// Barra do aviso: Tipo ▾, Recolhível ▾ e Excluir, sobre o aviso em que está o cursor

class AdmonitionBar {
  private bar?: HTMLElement;
  private menu?: HTMLElement;
  private pos?: number;

  constructor(
    private readonly view: EditorView,
    private readonly text: () => ComponentsText,
  ) {
    view.dom.addEventListener('blur', this.onBlur);
    window.addEventListener('scroll', this.place, true);
    window.addEventListener('resize', this.place);
  }

  private readonly onBlur = (event: FocusEvent) => {
    const to = event.relatedTarget as globalThis.Node | null;
    if (to && (this.bar?.contains(to) || this.menu?.contains(to))) return;
    this.hide();
  };

  /** O aviso de dentro com o cursor. */
  private target(state: EditorState): { pos: number; node: Node } | undefined {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name === 'td_admonition' || node.type.name === 'td_cards') return { pos: $from.before(d), node };
    }
    return undefined;
  }

  update() {
    const { view } = this;
    const target = view.editable && view.hasFocus() ? this.target(view.state) : undefined;
    if (!target) return this.hide();
    const signature = `${target.pos}:${target.node.type.name}:${target.node.attrs.kind}:${target.node.attrs.marker}`;
    if (this.bar?.dataset.signature !== signature) this.build(target.pos, target.node, signature);
    this.place();
  }

  private build(pos: number, node: Node, signature: string) {
    this.hide();
    this.pos = pos;
    const text = this.text();
    const bar = document.createElement('div');
    bar.className = 'mermaid-node-bar td-bar';
    bar.setAttribute('role', 'toolbar');
    bar.dataset.signature = signature;
    bar.addEventListener('pointerdown', event => event.preventDefault());
    if (node.type.name === 'td_cards') {
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = text.card.add;
      add.addEventListener('click', () => this.addCard());
      bar.append(add, this.removeButton(text.remove));
      (this.view.dom.closest('.milkdown') ?? document.body).append(bar);
      this.bar = bar;
      return;
    }
    const style = kindStyle(node.attrs.kind);
    const kindName = (MENU_KINDS as readonly string[]).includes(style) ? text.kinds[style as MenuKind] : node.attrs.kind;
    const dropdown = (label: string, dot: string | undefined, open: (button: HTMLButtonElement) => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.add('mermaid-bar-dropdown');
      if (dot) button.append(kindDot(dot));
      button.append(label);
      const caret = document.createElement('span');
      caret.className = 'mermaid-bar-caret';
      caret.setAttribute('aria-hidden', 'true');
      caret.textContent = '▾';
      button.append(caret);
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-label', label === kindName ? `${text.kind}: ${label}` : label);
      button.addEventListener('click', () => {
        const wasOpen = button.getAttribute('aria-expanded') === 'true';
        this.closeMenu();
        if (!wasOpen) open(button);
      });
      bar.append(button);
    };
    dropdown(kindName, style, button =>
      this.choose(
        button,
        text.kindTitle,
        MENU_KINDS.map(k => ({ key: k, name: text.kinds[k], dot: k })),
        style,
        kind => this.change(n => ({ ...n.attrs, kind })),
      ),
    );
    const mode = MODE_OF[node.attrs.marker as Marker];
    dropdown(text.collapse, undefined, button =>
      this.choose(
        button,
        text.collapseTitle,
        (['open', 'closed', 'expanded'] as CollapseMode[]).map(k => ({ key: k, name: text.collapseModes[k] })),
        mode,
        next => this.change(n => ({ ...n.attrs, marker: MARKER_OF[next] })),
      ),
    );
    bar.append(this.removeButton(text.remove));
    (this.view.dom.closest('.milkdown') ?? document.body).append(bar);
    this.bar = bar;
  }

  private removeButton(label: string) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = label;
    remove.addEventListener('click', () => {
      const now = this.current();
      if (!now) return;
      this.hide();
      this.view.dispatch(this.view.state.tr.delete(now.pos, now.pos + now.node.nodeSize).scrollIntoView());
      this.view.focus();
    });
    return remove;
  }

  /** Card novo no fim da grade, com o título selecionado para trocar. */
  private addCard() {
    const now = this.current();
    if (!now) return;
    const { state } = this.view;
    let list: { pos: number; node: Node } | undefined;
    now.node.forEach((child, offset) => {
      if (child.type.name === 'bullet_list' || child.type.name === 'ordered_list') list = { pos: now.pos + 1 + offset, node: child };
    });
    const text = this.text().card;
    let tr = state.tr;
    let start: number;
    if (list) {
      const end = list.pos + list.node.nodeSize - 1;
      tr = tr.insert(end, newCard(state.schema, text, list.node.lastChild ?? undefined));
      start = end + 2;
    } else {
      const end = now.pos + now.node.nodeSize - 1;
      tr = tr.insert(end, state.schema.nodes.bullet_list.create({ spread: true }, newCard(state.schema, text)));
      start = end + 3;
    }
    tr.setSelection(TextSelection.create(tr.doc, start, start + text.title.length));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  private current() {
    if (this.pos === undefined) return undefined;
    const node = this.view.state.doc.nodeAt(this.pos);
    return node?.type.name === 'td_admonition' || node?.type.name === 'td_cards' ? { pos: this.pos, node } : undefined;
  }

  private change(attrs: (node: Node) => Record<string, unknown>) {
    const now = this.current();
    if (!now) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(now.pos, undefined, attrs(now.node)));
    this.view.focus();
  }

  private choose<K extends string>(
    button: HTMLButtonElement,
    title: string,
    items: { key: K; name: string; dot?: string }[],
    current: K,
    pick: (key: K) => void,
  ) {
    const menu = popup(button, title, 'td-kind-menu');
    for (const item of items) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', String(item.key === current));
      option.dataset.key = item.key;
      if (item.dot) option.append(kindDot(item.dot));
      const name = document.createElement('span');
      name.textContent = item.name;
      option.append(name);
      option.addEventListener('click', () => {
        this.closeMenu();
        if (item.key !== current) pick(item.key);
      });
      menu.items.append(option);
    }
    this.menu = menu.place();
    button.setAttribute('aria-expanded', 'true');
  }

  private readonly place = () => {
    const bar = this.bar;
    if (!bar) return;
    const dom = this.pos === undefined ? null : (this.view.nodeDOM(this.pos) as HTMLElement | null);
    if (!dom?.isConnected) return this.hide();
    const box = dom.getBoundingClientRect();
    const { width, height } = bar.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8));
    const top = box.top - height - 4 >= 8 ? box.top - height - 4 : box.top + 4;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  };

  closeMenu() {
    this.menu?.remove();
    this.menu = undefined;
    this.bar?.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
  }

  keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.menu) {
      this.closeMenu();
      return true;
    }
    return false;
  }

  hide() {
    this.closeMenu();
    this.bar?.remove();
    this.bar = undefined;
    this.pos = undefined;
  }

  destroy() {
    this.hide();
    this.view.dom.removeEventListener('blur', this.onBlur);
    window.removeEventListener('scroll', this.place, true);
    window.removeEventListener('resize', this.place);
  }
}

function kindDot(kind: string) {
  const dot = document.createElement('span');
  dot.className = `td-kind-dot td-kind-${kindStyle(kind)}`;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

// ---------------------------------------------------------------------------------------------------------------

export const techdocsComponentsPlugin = $prose(ctx => {
  let editorView: EditorView | undefined;
  let bar: AdmonitionBar | undefined;
  const text = () => ctx.get(componentsCtx);
  const tabs = new Tabs(() => editorView, text);
  return new Plugin<TabsState>({
    key,
    state: {
      init: (_, state) => {
        const active = new Map<number, number>();
        return { active, decorations: decorate(state.doc, active, tabs) };
      },
      apply: (tr, value, _old, state) => {
        const meta = tr.getMeta(key) as TabsMeta | undefined;
        if (!tr.docChanged && !tr.selectionSet && !meta) return value;
        let active = value.active;
        if (tr.docChanged) {
          active = new Map();
          for (const [start, index] of value.active) active.set(tr.mapping.map(start), index);
        }
        const all = groups(state.doc);
        // A aba com o cursor passa a ser a escolhida (a busca, as setas e o clique na faixa chegam nela)
        for (const group of all) {
          const index = tabWithCursor(group, state);
          if (index >= 0 && active.get(group.tabs[0].pos) !== index) {
            if (active === value.active) active = new Map(active);
            active.set(group.tabs[0].pos, index);
          }
        }
        if (meta) {
          if (active === value.active) active = new Map(active);
          const start = tr.docChanged ? tr.mapping.map(meta.start) : meta.start;
          active.set(all.find(g => g.tabs.some(t => t.pos === start) || g.tabs[0].pos === start)?.tabs[0].pos ?? start, meta.index);
        }
        if (!tr.docChanged && active === value.active) return value;
        return { active, decorations: decorate(state.doc, active, tabs) };
      },
    },
    props: {
      decorations: state => key.getState(state)?.decorations,
      handleKeyDown: (view, event) => {
        if (bar?.keydown(event)) return true;
        // Enter no título do aviso vai para o texto (o título é uma linha só)
        const { $from, empty } = view.state.selection;
        if (event.key === 'Enter' && empty && $from.parent.type.name === 'td_title') {
          const next = Selection.findFrom(view.state.doc.resolve($from.after()), 1, true);
          if (next) view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
          return true;
        }
        return false;
      },
    },
    view: view => {
      editorView = view;
      bar = new AdmonitionBar(view, text);
      return {
        update: () => bar?.update(),
        destroy: () => {
          bar?.destroy();
          tabs.closeMenu();
          bar = undefined;
          editorView = undefined;
        },
      };
    },
  });
});

/** Tudo o que o editor usa: o Markdown, os nós e o plugin. */
export const techdocsComponents = [remarkTechdocsComponents, titleSchema, admonitionSchema, tabSchema, cardsSchema, techdocsComponentsPlugin].flat();
