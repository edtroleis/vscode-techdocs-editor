import { createSlice } from '@milkdown/kit/ctx';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { blockPosition, openCodeAt, targetFromElement } from './diagramDoubleClick';
import { type CodeRange, locateInDiagram } from './diagramSource';
import {
  addNode,
  connect,
  edgeLabel,
  edgeStyle,
  type FlowchartWords,
  isFlowchart,
  LINE_STYLES,
  type LineStyle,
  nodeShape,
  removeEdge,
  removeNode,
  reverseEdge,
  setEdgeStyle,
  setShape,
  SHAPES,
  type ShapeKey,
} from './flowchartEdit';
import { isValidDiagram } from './mermaidPreview';

/**
 * Barra do nó no fluxograma (spec 06, M12–M16, M33): clique simples num nó mostra Forma ▾, + Depois ▾, Ligar a…,
 * Texto e Apagar; clique numa seta (M34), Linha ▾, Texto, Inverter e Apagar ligação. Cada ação muda o código pelo
 * `flowchartEdit.ts`, só se o Mermaid aceita o resultado, numa transação. Como no clique duplo, o node view do
 * Crepe para os eventos: o listener fica no `view.dom`.
 */

export type DiagramBarText = {
  shape: string;
  after: string;
  text: string;
  line: string;
  reverse: string;
  removeEdge: string;
  shapeTitle: string;
  afterTitle: string;
  lineTitle: string;
  /** Texto novo de uma seta, selecionado para escrever. */
  edgeText: string;
  shapes: Record<ShapeKey, { name: string; hint: string }>;
  lines: Record<LineStyle, string>;
  connect: string;
  remove: string;
  connectHint: string;
  /** Dica durante o arrasto (M19). */
  dragHint: string;
  failed: string;
};

export type DiagramBarConfig = { bar: DiagramBarText; words: FlowchartWords; hint: string };

export const diagramBarCtx = createSlice<DiagramBarConfig>(
  {
    bar: {
      shape: 'Shape',
      after: '+ After',
      text: 'Text',
      line: 'Line',
      reverse: 'Reverse',
      removeEdge: 'Delete link',
      shapeTitle: 'Node shape',
      afterTitle: 'Add after this node',
      lineTitle: 'Line',
      edgeText: 'text',
      shapes: Object.fromEntries(SHAPES.map(s => [s, { name: s, hint: '' }])) as DiagramBarText['shapes'],
      lines: Object.fromEntries(LINE_STYLES.map(s => [s, s])) as DiagramBarText['lines'],
      connect: 'Connect to…',
      remove: 'Delete',
      connectHint: 'Click the target node (Esc cancels)',
      dragHint: 'Drop on a node to connect, or on an empty space to add a step (Esc cancels)',
      failed: "Couldn't change the diagram automatically; edit the code",
    },
    words: { step: 'New step', decision: 'New decision?', yes: 'Yes', no: 'No' },
    hint: '',
  },
  'docsEditorDiagramBar',
);

const key = new PluginKey('docs-editor-diagram-node-bar');
/** A partir de quantos pixels apertar e mover num nó vira arrasto (menos que isso é clique, M19). */
const DRAG_START_PX = 5;

type FoundNode = { gNode: Element; block: Element; pos: number; id: string };
/** A seta clicada: o caminho no SVG, a ordem dela no desenho (a do código) e as pontas. */
type FoundEdge = { path: SVGPathElement; block: Element; pos: number; index: number; from: string; to: string; anchor: DOMRect };
const FAILED_MS = 6000;
/** Quantos pixels em volta da linha da seta ainda contam como clique nela. */
const EDGE_HIT_PX = 12;

/** Miniaturas das formas no menu (40×30). */
const SHAPE_ICONS: Record<ShapeKey, string> = {
  step: '<rect x="3" y="6" width="34" height="18"/>',
  start: '<rect x="3" y="6" width="34" height="18" rx="9"/>',
  decision: '<polygon points="20,2 37,15 20,28 3,15"/>',
  database: '<path d="M6 8 v14 a14 4 0 0 0 28 0 v-14"/><ellipse cx="20" cy="8" rx="14" ry="4"/>',
  io: '<polygon points="9,6 37,6 31,24 3,24"/>',
  doc: '<path d="M4 5 h32 v17 q-8 -5 -16 0 t-16 0 z"/>',
  subroutine: '<rect x="3" y="6" width="34" height="18"/><path d="M8 6 v18 M32 6 v18"/>',
  prep: '<polygon points="9,6 31,6 37,15 31,24 9,24 3,15"/>',
  round: '<rect x="3" y="6" width="34" height="18" rx="5"/>',
  circle: '<circle cx="20" cy="15" r="11"/>',
};
/** Miniaturas das linhas no menu (58×30). */
const LINE_ICONS: Record<LineStyle, string> = {
  normal: '<path d="M4 15 h44"/><path class="head" d="M52 15 l-7 -4 v8 z"/>',
  dotted: '<path d="M4 15 h44" stroke-dasharray="4 4"/><path class="head" d="M52 15 l-7 -4 v8 z"/>',
  thick: '<path d="M4 15 h42" stroke-width="5"/><path class="head" d="M54 15 l-9 -6 v12 z"/>',
  open: '<path d="M4 15 h50"/>',
  both: '<path d="M10 15 h38"/><path class="head" d="M52 15 l-7 -4 v8 z M4 15 l7 -4 v8 z"/>',
};
/** O `data-id` das setas do Mermaid: `L_<de>_<para>_<n>`. */
const edgeIdMatches = (dataId: string | null, from: string, to: string) => !!dataId?.startsWith(`L_${from}_${to}_`);

/** Resultado de uma ação: o código novo (e o rótulo a selecionar), `null` se não há o que mudar. */
type Change = { code: string; label?: CodeRange } | null;

class NodeBar {
  private bar: HTMLElement | undefined;
  /** O menu aberto a partir de um botão da barra (Forma, + Depois, Linha). */
  private menu: HTMLElement | undefined;
  /** A seta destacada enquanto a barra dela está aberta. */
  private edge: FoundEdge | undefined;
  /** O nó da barra aberta ou do modo Ligar. */
  private target: { block: Element; pos: number; id: string } | undefined;
  private connecting = false;
  /** Apertou num nó (ainda não arrastou). */
  private press: { x: number; y: number; found: FoundNode } | undefined;
  /** Arrastando a partir de um nó (M17–M19). */
  private dragging: { found: FoundNode; overlay: SVGSVGElement; line: SVGLineElement; over?: Element } | undefined;
  /** O click que chega depois de soltar um arrasto não abre a barra. */
  private swallowClick = false;

  constructor(
    private readonly view: EditorView,
    private readonly text: () => DiagramBarConfig,
  ) {
    view.dom.addEventListener('click', this.onClick);
    view.dom.addEventListener('dblclick', this.close);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointercancel', this.cancelDrag);
    window.addEventListener('blur', this.cancelDrag);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.close);
  }

  destroy() {
    this.close();
    this.stopDragging();
    clearTimeout(this.failTimer);
    this.view.dom.removeEventListener('click', this.onClick);
    this.view.dom.removeEventListener('dblclick', this.close);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointercancel', this.cancelDrag);
    window.removeEventListener('blur', this.cancelDrag);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.close);
  }

  /** O documento mudou (digitar no código, desfazer) ou virou só leitura: a barra e o modo Ligar não valem mais. */
  changed() {
    this.close();
    this.stopDragging();
    this.press = undefined;
  }

  /** Fecha a barra e cancela o modo Ligar. */
  readonly close = () => {
    this.closeMenu();
    this.bar?.remove();
    this.bar = undefined;
    this.edge?.path.classList.remove('mermaid-edge-selected');
    this.edge = undefined;
    if (this.connecting) this.stopConnecting();
    this.target = undefined;
  };

  /** O nó clicado, se é de um fluxograma num bloco de código editável. */
  private nodeAt(element: Element): FoundNode | undefined {
    const gNode = element.closest('g.node');
    if (!this.view.editable || !gNode || !gNode.closest('.mermaid-diagram')) return undefined;
    const block = gNode.closest('.milkdown-code-block');
    const pos = block ? blockPosition(this.view, block) : undefined;
    const id = targetFromElement(element).nodeId;
    if (!block || pos === undefined || !id) return undefined;
    if (!isFlowchart(this.view.state.doc.nodeAt(pos)?.textContent ?? '')) return undefined;
    return { gNode, block, pos, id };
  }

  /** A seta no ponto clicado: no texto dela, ou a até alguns pixels da linha. */
  private edgeAt(element: Element, x: number, y: number): FoundEdge | undefined {
    const svg = element.closest('.mermaid-diagram svg');
    const block = svg?.closest('.milkdown-code-block');
    if (!this.view.editable || !svg || !block || element.closest('g.node')) return undefined;
    const pos = blockPosition(this.view, block);
    const code = pos === undefined ? '' : (this.view.state.doc.nodeAt(pos)?.textContent ?? '');
    if (pos === undefined || !isFlowchart(code)) return undefined;
    const paths = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.flowchart-link')].filter(
      (p, i, all) => all.indexOf(p) === i && p.getAttribute('data-id'),
    );
    const labelId = element.closest('.edgeLabel')?.querySelector('[data-id]')?.getAttribute('data-id');
    let path = labelId ? paths.find(p => p.getAttribute('data-id') === labelId) : undefined;
    if (!path)
      path = paths.find(p => {
        const matrix = p.getScreenCTM();
        if (!matrix || typeof p.isPointInStroke !== 'function') return false;
        const point = new DOMPoint(x, y).matrixTransform(matrix.inverse());
        const width = p.style.strokeWidth;
        // A espessura da linha conta em unidades do SVG: o equivalente a EDGE_HIT_PX na tela
        p.style.strokeWidth = String(EDGE_HIT_PX / Math.max(Math.abs(matrix.a), 0.01));
        const hit = p.isPointInStroke(point);
        p.style.strokeWidth = width;
        return hit;
      });
    if (!path) return undefined;
    const index = paths.indexOf(path);
    const ends = this.edgeEnds(code, index, path.getAttribute('data-id'));
    // A barra fica perto do texto da seta (ou do ponto clicado): a caixa da seta inteira pode cobrir os nós
    const dataId = path.getAttribute('data-id');
    const label = [...svg.querySelectorAll('.edgeLabels > .edgeLabel')].find(l => l.querySelector(`[data-id="${CSS.escape(dataId ?? '')}"]`));
    const labelBox = label?.getBoundingClientRect();
    const anchor = labelBox && labelBox.width > 0 ? labelBox : new DOMRect(x, y, 0, 0);
    return ends && { path, block, pos, index, ...ends, anchor };
  }

  /** As pontas da seta `index` no código, se conferem com o `data-id` do desenho. */
  private edgeEnds(code: string, index: number, dataId: string | null): { from: string; to: string } | undefined {
    const match = /^L_(.+)_\d+$/.exec(dataId ?? '');
    if (!match) return undefined;
    // Ids com `_` deixam o `data-id` ambíguo: a combinação que o código tem na posição `index` decide
    const parts = match[1].split('_');
    for (let cut = 1; cut < parts.length; cut++) {
      const from = parts.slice(0, cut).join('_');
      const to = parts.slice(cut).join('_');
      if (edgeIdMatches(dataId, from, to) && edgeStyle(code, index, from, to)) return { from, to };
    }
    return undefined;
  }

  private readonly onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    // O segundo clique de um clique duplo: o dblclick abre o código
    if (event.detail > 1) return;
    const found = this.nodeAt(event.target);
    if (this.connecting && this.target) {
      const from = this.target;
      this.close();
      if (found && found.block === from.block && found.id !== from.id) {
        void this.run(from, code => {
          const next = connect(code, from.id, found.id, this.text().words);
          return next === undefined ? null : { code: next };
        });
      }
      return;
    }
    this.close();
    if (found) return this.open(found);
    const edge = this.edgeAt(event.target, event.clientX, event.clientY);
    if (edge) this.openEdge(edge);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    this.swallowClick = false;
    if (event.button === 0 && !this.connecting && event.target instanceof Element) {
      const found = this.nodeAt(event.target);
      this.press = found && { x: event.clientX, y: event.clientY, found };
    }
    if (!this.bar && !this.connecting) return;
    const target = event.target;
    if (!(target instanceof Element)) return this.close();
    if (this.bar?.contains(target) || this.menu?.contains(target)) return;
    // Num nó: o click decide (outra barra, o destino do Ligar)
    if (target.closest('.mermaid-diagram g.node')) return;
    this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (!this.bar && !this.connecting && !this.dragging)) return;
    event.preventDefault();
    event.stopPropagation();
    // Esc com um menu aberto fecha só o menu
    if (this.menu) return this.closeMenu();
    if (this.dragging) {
      // O botão ainda está apertado: o click de quando soltar não abre a barra
      this.stopDragging();
      this.swallowClick = true;
    }
    this.press = undefined;
    this.close();
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.press && !this.dragging) {
      if (Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) < DRAG_START_PX) return;
      this.startDragging(this.press.found);
      this.press = undefined;
    }
    const dragging = this.dragging;
    if (!dragging) return;
    event.preventDefault();
    // O arrasto não seleciona os textos do desenho
    window.getSelection()?.removeAllRanges();
    dragging.line.setAttribute('x2', String(event.clientX));
    dragging.line.setAttribute('y2', String(event.clientY));
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const target = under && this.nodeAt(under);
    const over = target && target.block === dragging.found.block && target.id !== dragging.found.id ? target.gNode : undefined;
    if (over === dragging.over) return;
    dragging.over?.classList.remove('mermaid-drop-target');
    over?.classList.add('mermaid-drop-target');
    dragging.over = over;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    this.press = undefined;
    const dragging = this.dragging;
    if (!dragging) return;
    this.stopDragging();
    this.swallowClick = true;
    // O click (se vier) chega logo depois do pointerup; se não vier, o próximo pointerdown limpa
    const { found } = dragging;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (!under) return;
    const target = this.nodeAt(under);
    if (target) {
      if (target.block !== found.block || target.id === found.id) return;
      void this.run(found, code => {
        const next = connect(code, found.id, target.id, this.text().words);
        return next === undefined ? null : { code: next };
      });
      return;
    }
    // Espaço vazio do mesmo desenho (a dica embaixo dele conta): um passo novo, como + Passo depois
    if (under.closest('.mermaid-diagram') && under.closest('.milkdown-code-block') === found.block)
      void this.run(found, code => addNode(code, found.id, 'step', this.text().words));
  };

  /** O arrasto foi interrompido (toque cancelado, a janela perdeu o foco): não liga nem cria nada. */
  private readonly cancelDrag = () => {
    this.press = undefined;
    if (!this.dragging) return;
    this.stopDragging();
    this.swallowClick = true;
  };

  private startDragging(found: FoundNode) {
    this.close();
    const ns = 'http://www.w3.org/2000/svg';
    const overlay = document.createElementNS(ns, 'svg');
    overlay.classList.add('mermaid-drag-line');
    const line = document.createElementNS(ns, 'line');
    const box = found.gNode.getBoundingClientRect();
    const x = String(box.left + box.width / 2);
    const y = String(box.top + box.height / 2);
    for (const [name, value] of [['x1', x], ['y1', y], ['x2', x], ['y2', y]]) line.setAttribute(name, value);
    overlay.append(line);
    (this.view.dom.closest('.milkdown') ?? document.body).append(overlay);
    document.documentElement.classList.add('mermaid-dragging');
    const hint = this.hint(found.block);
    if (hint) {
      this.clearFailure(hint);
      hint.textContent = this.text().bar.dragHint;
    }
    this.dragging = { found, overlay, line };
  }

  private stopDragging() {
    const dragging = this.dragging;
    if (!dragging) return;
    this.dragging = undefined;
    dragging.overlay.remove();
    dragging.over?.classList.remove('mermaid-drop-target');
    document.documentElement.classList.remove('mermaid-dragging');
    const hint = this.hint(dragging.found.block);
    if (hint) hint.textContent = this.text().hint;
  }

  private readonly onScroll = (event: Event) => {
    if (this.bar && !(event.target instanceof Node && (this.bar.contains(event.target) || this.menu?.contains(event.target)))) this.close();
  };

  private open(found: FoundNode) {
    const { bar: text, words } = this.text();
    const target = { block: found.block, pos: found.pos, id: found.id };
    this.target = target;
    const code = () => this.view.state.doc.nodeAt(target.pos)?.textContent ?? '';
    this.showBar(found.gNode.getBoundingClientRect(), [
      [text.shape, button => this.shapeMenu(button, text.shapeTitle, nodeShape(code(), target.id), shape => void this.run(target, c => ({ code: setShape(c, target.id, shape) })))],
      [text.after, button => this.shapeMenu(button, text.afterTitle, undefined, shape => void this.run(target, c => addNode(c, target.id, shape, words)))],
      [text.connect, () => this.startConnecting(target)],
      [text.text, () => this.editNodeText(found)],
      [text.remove, () => void this.run(target, c => ({ code: removeNode(c, target.id) }))],
    ]);
  }

  private openEdge(edge: FoundEdge) {
    const { bar: text } = this.text();
    const { index, from, to } = edge;
    this.edge = edge;
    edge.path.classList.add('mermaid-edge-selected');
    const target = { block: edge.block, pos: edge.pos, id: from };
    const code = () => this.view.state.doc.nodeAt(edge.pos)?.textContent ?? '';
    const or = (next: string | undefined) => (next === undefined ? null : { code: next });
    this.showBar(edge.anchor, [
      [text.line, button => this.lineMenu(button, edgeStyle(code(), index, from, to), style => void this.run(target, c => or(setEdgeStyle(c, index, from, to, style))))],
      [text.text, () => void this.run(target, c => edgeLabel(c, index, from, to, text.edgeText) ?? null, true)],
      [text.reverse, () => void this.run(target, c => or(reverseEdge(c, index, from, to)))],
      [text.removeEdge, () => void this.run(target, c => or(removeEdge(c, index, from, to)))],
    ]);
  }

  /** Leva ao código com o texto do nó selecionado (o mesmo do clique duplo). */
  private editNodeText(found: FoundNode) {
    this.close();
    const code = this.view.state.doc.nodeAt(found.pos)?.textContent ?? '';
    const label = found.gNode.querySelector('.nodeLabel, foreignObject, text') ?? found.gNode;
    const range = locateInDiagram(code, targetFromElement(label));
    if (range) openCodeAt(this.view, found.block, found.pos, range);
  }

  /**
   * Mostra a barra embaixo de `box` (em cima, se não cabe), dentro da janela. Botões com menu (função que
   * recebe o botão) ficam abertos; os outros fecham a barra antes de agir.
   */
  private showBar(box: DOMRect, actions: [string, (button: HTMLButtonElement) => void][]) {
    const bar = document.createElement('div');
    bar.className = 'mermaid-node-bar';
    bar.setAttribute('role', 'toolbar');
    // Os botões não tiram o foco do editor
    bar.addEventListener('pointerdown', event => event.preventDefault());
    const { bar: text } = this.text();
    const withMenu = new Set([text.shape, text.after, text.line]);
    for (const [label, action] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (withMenu.has(label)) {
        button.classList.add('mermaid-bar-dropdown');
        const caret = document.createElement('span');
        caret.className = 'mermaid-bar-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.textContent = '▾';
        button.append(caret);
        button.setAttribute('aria-haspopup', 'menu');
        button.addEventListener('click', () => {
          const open = button.getAttribute('aria-expanded') === 'true';
          this.closeMenu();
          if (!open) action(button);
        });
      } else
        button.addEventListener('click', () => {
          const edge = this.edge;
          this.closeMenu();
          this.bar?.remove();
          this.bar = undefined;
          action(button);
          // A seta continua destacada até a mudança redesenhar
          if (edge && !this.bar) edge.path.classList.remove('mermaid-edge-selected');
        });
      bar.append(button);
    }
    // Dentro do .milkdown, onde estão as cores do tema do Crepe (fixed: a posição é a da janela)
    (this.view.dom.closest('.milkdown') ?? document.body).append(bar);
    this.bar = bar;
    const { width, height } = bar.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 8));
    // Embaixo: em cima ficaria sobre a barra do bloco (Copiar · Editar · Excluir)
    const below = box.bottom + 6;
    const top = below + height <= window.innerHeight - 8 || box.top - height - 6 < 8 ? below : box.top - height - 6;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = undefined;
    this.bar?.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
  }

  /** Menu embaixo do botão, com os itens (miniatura, nome, dica) e o atual marcado. */
  private showMenu<K extends string>(
    button: HTMLButtonElement,
    title: string,
    items: { key: K; icon: string; size: [number, number]; name: string; hint?: string }[],
    current: K | undefined,
    choose: (key: K) => void,
    className: string,
  ) {
    const menu = document.createElement('div');
    menu.className = `mermaid-bar-menu ${className}`;
    menu.setAttribute('role', 'menu');
    menu.addEventListener('pointerdown', event => event.preventDefault());
    const heading = document.createElement('div');
    heading.className = 'mermaid-bar-menu-title';
    heading.textContent = title;
    const list = document.createElement('div');
    list.className = 'mermaid-bar-menu-items';
    for (const item of items) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', String(item.key === current));
      option.dataset.key = item.key;
      const [w, h] = item.size;
      option.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${item.icon}</svg>`;
      const words = document.createElement('span');
      const name = document.createElement('span');
      name.textContent = item.name;
      words.append(name);
      if (item.hint) {
        const hint = document.createElement('small');
        hint.textContent = item.hint;
        words.append(hint);
      }
      option.append(words);
      option.addEventListener('click', () => {
        this.close();
        if (item.key !== current) choose(item.key);
      });
      list.append(option);
    }
    menu.append(heading, list);
    (this.view.dom.closest('.milkdown') ?? document.body).append(menu);
    this.menu = menu;
    button.setAttribute('aria-expanded', 'true');
    const box = button.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
    const top = box.bottom + 4 + height <= window.innerHeight - 8 ? box.bottom + 4 : Math.max(8, box.top - height - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  private shapeMenu(button: HTMLButtonElement, title: string, current: ShapeKey | undefined, choose: (shape: ShapeKey) => void) {
    const { shapes } = this.text().bar;
    const items = SHAPES.map(key => ({ key, icon: SHAPE_ICONS[key], size: [40, 30] as [number, number], ...shapes[key] }));
    this.showMenu(button, title, items, current, choose, 'mermaid-shape-menu');
  }

  private lineMenu(button: HTMLButtonElement, current: LineStyle | undefined, choose: (style: LineStyle) => void) {
    const { lines, lineTitle } = this.text().bar;
    const items = LINE_STYLES.map(key => ({ key, icon: LINE_ICONS[key], size: [58, 30] as [number, number], name: lines[key] }));
    this.showMenu(button, lineTitle, items, current, choose, 'mermaid-line-menu');
  }

  private hint(block: Element) {
    return block.querySelector<HTMLElement>('.mermaid-hint');
  }

  private startConnecting(target: { block: Element; pos: number; id: string }) {
    this.target = target;
    this.connecting = true;
    target.block.classList.add('mermaid-connecting');
    const hint = this.hint(target.block);
    if (!hint) return;
    // A mensagem de erro de antes sai (e o tempo dela não troca a dica no meio do Ligar)
    this.clearFailure(hint);
    hint.textContent = this.text().bar.connectHint;
  }

  private stopConnecting() {
    this.connecting = false;
    const block = this.target?.block;
    if (!block) return;
    block.classList.remove('mermaid-connecting');
    const hint = this.hint(block);
    if (hint) hint.textContent = this.text().hint;
  }

  private failTimer: ReturnType<typeof setTimeout> | undefined;

  /** A mensagem do M16 no lugar da dica, por alguns segundos. */
  private fail(block: Element) {
    const hint = this.hint(block);
    if (!hint) return;
    this.clearFailure(hint);
    hint.textContent = this.text().bar.failed;
    hint.classList.add('mermaid-hint-error');
    hint.setAttribute('role', 'status');
    this.failTimer = setTimeout(() => {
      if (!hint.isConnected || !hint.classList.contains('mermaid-hint-error')) return;
      this.clearFailure(hint);
      hint.textContent = this.text().hint;
    }, FAILED_MS);
  }

  private clearFailure(hint: HTMLElement) {
    clearTimeout(this.failTimer);
    this.failTimer = undefined;
    hint.classList.remove('mermaid-hint-error');
    hint.removeAttribute('role');
  }

  /** Calcula o código novo, valida com o Mermaid e troca o conteúdo do bloco numa transação. */
  private async run(target: { block: Element; pos: number; id: string }, change: (code: string) => Change, sameIsFine = false) {
    const { view } = this;
    const node = view.state.doc.nodeAt(target.pos);
    if (!view.editable || node?.type.name !== 'code_block') return;
    const before = node.textContent;
    const next = change(before);
    if (!next) return;
    if (!next.code || (next.code === before && !sameIsFine)) return this.fail(target.block);
    const valid = await isValidDiagram(next.code);
    // Mudou no meio da validação: desiste
    const now = view.state.doc.nodeAt(target.pos);
    if (!view.editable || now?.type.name !== 'code_block' || now.textContent !== before || view.nodeDOM(target.pos) !== target.block) return;
    if (!valid) return this.fail(target.block);
    if (next.code !== before) {
      const tr = view.state.tr.replaceWith(target.pos + 1, target.pos + 1 + now.content.size, view.state.schema.text(next.code));
      view.dispatch(tr);
    }
    if (next.label) openCodeAt(view, target.block, target.pos, next.label);
  }
}

export const diagramNodeBarPlugin = $prose(
  ctx =>
    new Plugin({
      key,
      view: view => {
        const bar = new NodeBar(view, () => ctx.get(diagramBarCtx));
        return {
          update: (view, prev) => {
            if (!view.state.doc.eq(prev.doc) || !view.editable) bar.changed();
          },
          destroy: () => bar.destroy(),
        };
      },
    }),
);
