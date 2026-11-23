import { editorViewCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { DIAGRAM_GROUPS, type DiagramGroup } from './diagramTemplates';
import { diagramInsertCtx, insertDiagram } from './insertDiagram';
import type { DiagramTemplate } from './labels';
import { drawThumbnail } from './mermaidPreview';

/**
 * Galeria de diagramas (spec 06, M22): o botão de diagrama da barra abre uma janela com o desenho de cada modelo,
 * filtro por grupo e busca pelo nome; escolher um insere o exemplo como o menu "/". Os tipos novos do Mermaid têm
 * a etiqueta com a versão que o TechDocs precisa (M23), aqui e no menu "/" (diagramMenuChipsPlugin).
 */

/** O nome sem o "Diagrama: " do menu "/" (lá ele serve para "/diagrama" achar todos). */
const shortName = (label: string) => label.replace(/^[^:]+:\s*/, '');

/** Para a busca: sem acento e em minúsculas ("graficos" acha "gráficos"). */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let closeOpen: (() => void) | undefined;

export function openDiagramGallery(ctx: Ctx) {
  const { templates, gallery } = ctx.get(diagramInsertCtx);
  // Sem os modelos (outro uso do editor), o botão faz o de antes: insere o fluxograma
  if (!templates?.length || !gallery) return insertDiagram(ctx);
  closeOpen?.();
  const view = ctx.get(editorViewCtx);
  const host = view.dom.closest<HTMLElement>('.milkdown') ?? document.body;

  const backdrop = el('div', 'diagram-gallery-backdrop');
  const dialog = el('div', 'diagram-gallery');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', gallery.title);
  const head = el('div', 'diagram-gallery-head');
  const title = el('h2', 'diagram-gallery-title', gallery.title);
  const search = el('input', 'diagram-gallery-search');
  search.type = 'search';
  search.placeholder = gallery.search;
  search.setAttribute('aria-label', gallery.search);
  const close = el('button', 'diagram-gallery-close', '×');
  close.type = 'button';
  close.title = gallery.close;
  close.setAttribute('aria-label', gallery.close);
  head.append(title, search, close);

  let group: DiagramGroup | 'all' = 'all';
  const filters = el('div', 'diagram-gallery-filters');
  filters.setAttribute('role', 'group');
  const filterButtons = (['all', ...DIAGRAM_GROUPS] as const).map(key => {
    const button = el('button', 'diagram-gallery-filter', key === 'all' ? gallery.all : gallery.groups[key]);
    button.type = 'button';
    button.dataset.group = key;
    button.setAttribute('aria-pressed', String(key === group));
    filters.append(button);
    return button;
  });

  const grid = el('div', 'diagram-gallery-grid');
  const cards = templates.map(template => {
    const card = el('button', 'diagram-gallery-card');
    card.type = 'button';
    card.dataset.key = template.key;
    const thumb = el('div', 'diagram-gallery-thumb');
    const foot = el('div', 'diagram-gallery-name');
    foot.append(el('span', undefined, shortName(template.label)));
    if (template.since) foot.append(chip(template, gallery.sinceChip, gallery.sinceTitle));
    card.append(thumb, foot);
    grid.append(card);
    // Miniatura pela fila dos desenhos: chega uma por vez, sem travar a janela nem atrasar os diagramas da página
    drawThumbnail(template.sample).then(
      svg => {
        thumb.innerHTML = svg;
      },
      () => undefined,
    );
    return { card, template };
  });

  dialog.append(head, filters, grid);
  backdrop.append(dialog);
  host.append(backdrop);

  const visible = () => cards.filter(c => !c.card.hidden);
  const refresh = () => {
    const words = plain(search.value.trim());
    for (const { card, template } of cards)
      card.hidden = (group !== 'all' && template.group !== group) || (!!words && !plain(template.label).includes(words));
    for (const button of filterButtons) button.setAttribute('aria-pressed', String(button.dataset.group === group));
  };

  const finish = (template?: DiagramTemplate) => {
    closeOpen = undefined;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (template) insertDiagram(ctx, template.sample);
    else view.focus();
  };
  closeOpen = () => finish();

  const onKey = (event: KeyboardEvent) => {
    // Tab fica dentro da janela (do último volta ao primeiro): o foco não vai para a página por trás
    if (event.key === 'Tab') {
      const focusable = [search, close, ...filterButtons, ...visible().map(c => c.card)];
      const at = focusable.indexOf(document.activeElement as HTMLInputElement);
      const next = at < 0 ? 0 : (at + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[next].focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    if (event.key === 'Enter' && document.activeElement === search) {
      // Enter na busca escolhe o primeiro que sobrou
      event.preventDefault();
      const first = visible()[0];
      if (first) finish(first.template);
      return;
    }
    const arrows: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 0, ArrowUp: 0 };
    if (!(event.key in arrows)) return;
    const shown = visible();
    const at = shown.findIndex(c => c.card === document.activeElement);
    if (at < 0) {
      if (event.key === 'ArrowDown' && shown[0]) {
        event.preventDefault();
        shown[0].card.focus();
      }
      return;
    }
    event.preventDefault();
    // Colunas da grade pela posição dos cartões: setas para cima e para baixo pulam uma linha
    const columns = Math.max(1, shown.filter(c => c.card.offsetTop === shown[0].card.offsetTop).length);
    const step = arrows[event.key] || (event.key === 'ArrowDown' ? columns : -columns);
    const next = at + step;
    if (next < 0 && event.key === 'ArrowUp') search.focus();
    else shown[Math.min(Math.max(next, 0), shown.length - 1)]?.card.focus();
  };
  document.addEventListener('keydown', onKey, true);

  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) finish();
  });
  close.addEventListener('click', () => finish());
  search.addEventListener('input', refresh);
  filters.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-group]');
    if (!button) return;
    group = button.dataset.group as DiagramGroup | 'all';
    refresh();
  });
  grid.addEventListener('click', event => {
    const card = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-key]');
    const chosen = card && cards.find(c => c.card === card);
    if (chosen) finish(chosen.template);
  });
  search.focus();
}

function chip(template: DiagramTemplate, text: (since: string) => string, title: (since: string) => string) {
  const node = el('span', 'diagram-since-chip', text(template.since!));
  node.title = title(template.since!);
  return node;
}

/**
 * Etiqueta dos tipos novos no menu "/" (M23): o menu do Crepe só tem ícone e nome, então a etiqueta vem por CSS,
 * de um atributo posto nos itens pelo nome (atributos de fora não são apagados quando o menu se redesenha).
 */
const chipsKey = new PluginKey('docs-editor-diagram-menu-chips');

export const diagramMenuChipsPlugin = $prose(ctx => {
  const mark = (root: ParentNode) => {
    const { templates, gallery } = ctx.get(diagramInsertCtx);
    if (!templates || !gallery) return;
    for (const item of root.querySelectorAll<HTMLElement>('.milkdown-slash-menu li:not([data-diagram-checked])')) {
      item.dataset.diagramChecked = '';
      const label = item.querySelector('span:not(.milkdown-icon)')?.textContent ?? '';
      const template = templates.find(t => t.since && t.label === label);
      if (!template) continue;
      item.dataset.since = gallery.sinceChip(template.since!);
      item.title = gallery.sinceTitle(template.since!);
    }
  };
  return new Plugin({
    key: chipsKey,
    view: view => {
      const root = view.dom.closest('.milkdown') ?? document.body;
      const observer = new MutationObserver(() => mark(root));
      observer.observe(root, { childList: true, subtree: true });
      mark(root);
      return { destroy: () => observer.disconnect() };
    },
  });
});
