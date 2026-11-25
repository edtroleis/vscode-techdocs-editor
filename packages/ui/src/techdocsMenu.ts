import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { componentsCtx, type ComponentsText, insertComponent } from './techdocsComponents';
import { insertButton, insertDocLink, insertGlossary } from './techdocsInline';
import { icon } from './icons';
import { ICON_PAGE_KIND, pageKindsCtx } from './pageKinds';

/**
 * O grupo TechDocs (spec 01, M1): os mesmos itens no menu "/" e no botão TechDocs da barra de cima (os tipos de
 * página têm o botão deles). Cada `run`
 * espera o cursor num parágrafo vazio (no "/", o "/" já saiu); pela barra, `openTechdocsMenu` cria esse parágrafo.
 */

const svg = (inner: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${inner}</svg>`;
const ICON_ADMONITION = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r=".6" fill="currentColor"/><path d="M7 13h10M7 16h7"/>');
const ICON_COLLAPSIBLE = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 8l2 2 2-2M12 9h6M7 14h10M7 17h7"/>');
const ICON_TABS = svg('<path d="M3 8V5.5A1.5 1.5 0 0 1 4.5 4H10v4M10 8V4h5v4"/><rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M7 13h10M7 16h6"/>');
const ICON_CARDS = svg('<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>');
const ICON_BUTTON = svg('<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M8 12h8"/>');
const ICON_GLOSSARY = svg('<path d="M4 6h7M7 10h12M4 14h7M7 18h12"/>');
const ICON_DOC_LINK = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');
/** O ícone do botão da barra (livros, como a documentação; no estilo dos outros ícones da barra). */
export const TECHDOCS_ICON = icon(
  'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
);

export type TechdocsItem = { id: string; label: string; icon: string; run: (ctx: Ctx) => void };

export function techdocsItems(text: ComponentsText): TechdocsItem[] {
  return [
    { id: 'admonition', label: text.admonition, icon: ICON_ADMONITION, run: ctx => insertComponent(ctx, 'admonition') },
    { id: 'collapsible', label: text.collapsible, icon: ICON_COLLAPSIBLE, run: ctx => insertComponent(ctx, 'collapsible') },
    { id: 'tabs', label: text.tabs, icon: ICON_TABS, run: ctx => insertComponent(ctx, 'tabs') },
    { id: 'cards', label: text.cards, icon: ICON_CARDS, run: ctx => insertComponent(ctx, 'cards') },
    { id: 'button', label: text.button, icon: ICON_BUTTON, run: ctx => insertButton(ctx, text.buttonLabel) },
    { id: 'glossary', label: text.glossary, icon: ICON_GLOSSARY, run: ctx => insertGlossary(ctx, text.glossaryTerm, text.glossaryMeaning) },
    { id: 'doc-link', label: text.docLink, icon: ICON_DOC_LINK, run: ctx => insertDocLink(ctx) },
  ];
}

/**
 * Um parágrafo vazio para o componente, sem apagar nada: o do cursor, se já está vazio; senão um novo depois do
 * bloco do cursor (o de fora, no nível da página).
 */
function emptyParagraphAtCursor(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { $from } = state.selection;
  if ($from.parent.type.name === 'paragraph' && $from.parent.content.size === 0 && $from.depth === 1) return;
  const at = $from.depth ? $from.after(1) : state.doc.content.size;
  const tr = state.tr.insert(at, state.schema.nodes.paragraph.create());
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)));
}

let closeOpen: (() => void) | undefined;

export type MenuEntry = { icon: string; label: string; detail?: string; checked?: boolean; run: () => void };

/** Um menu embaixo do botão da barra de cima de nome `label`, com `entries`. */
export function openBarMenu(ctx: Ctx, label: string, entries: (close: () => void) => MenuEntry[]) {
  closeOpen?.();
  const view = ctx.get(editorViewCtx);
  const host = view.dom.closest<HTMLElement>('.milkdown') ?? document.body;
  const anchor = host.querySelector<HTMLElement>(`.top-bar-item[title="${label}"]`) ?? host;
  // O foco vai para o menu: o cursor de antes (na tabela, na citação…) volta antes de rodar o item
  const cursor = view.state.selection.getBookmark();
  const menu = document.createElement('div');
  menu.className = 'mermaid-bar-menu td-top-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.addEventListener('pointerdown', event => event.preventDefault());
  const items = document.createElement('div');
  items.className = 'mermaid-bar-menu-items';
  menu.append(items);
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key, true);
    closeOpen = undefined;
  };
  const outside = (event: Event) => {
    if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
      view.focus();
    }
  };
  for (const entry of entries(close)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (entry.checked !== undefined) button.setAttribute('aria-checked', String(entry.checked));
    button.innerHTML = entry.icon;
    const name = document.createElement('span');
    name.textContent = entry.label;
    button.append(name);
    if (entry.detail) {
      const detail = document.createElement('small');
      detail.textContent = entry.detail;
      button.append(detail);
    }
    button.addEventListener('click', () => {
      close();
      const selection = cursor.resolve(view.state.doc);
      if (!selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
      entry.run();
    });
    items.append(button);
  }
  host.append(menu);
  const box = anchor.getBoundingClientRect();
  const { width } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
  menu.style.top = `${box.bottom + 4}px`;
  // Muitos itens (os tipos de página da empresa): o menu vai até o fim da janela e rola por dentro
  menu.style.maxHeight = `${Math.max(120, window.innerHeight - box.bottom - 12)}px`;
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  closeOpen = close;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

/** O botão TechDocs da barra de cima: os componentes, embaixo do botão. */
export function openTechdocsMenu(ctx: Ctx) {
  const text = ctx.get(componentsCtx);
  const view = ctx.get(editorViewCtx);
  const { from, to } = view.state.selection;
  openBarMenu(ctx, text.group, () =>
    techdocsItems(text).map(item => ({
      icon: item.icon,
      label: item.label,
      run: () => {
        // O link para outra doc vale no texto selecionado; os outros entram num parágrafo novo
        if (item.id === 'doc-link' && from !== to) {
          view.focus();
          return insertDocLink(ctx);
        }
        emptyParagraphAtCursor(ctx);
        item.run(ctx);
      },
    })),
  );
}

/** O botão dos tipos de página (Runbook, Tutorial…): o texto vem da extensão e entra num parágrafo novo. */
export function openPageKindsMenu(ctx: Ctx) {
  const pageKinds = ctx.get(pageKindsCtx);
  openBarMenu(ctx, pageKinds.group, () =>
    pageKinds.kinds.map(kind => ({
      icon: ICON_PAGE_KIND,
      label: kind.label,
      detail: kind.description,
      run: () => {
        emptyParagraphAtCursor(ctx);
        pageKinds.pick(kind.id);
      },
    })),
  );
}
