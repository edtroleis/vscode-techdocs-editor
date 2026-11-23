import { createSlice } from '@milkdown/kit/ctx';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { blockPosition, openCodeAt, targetFromElement } from './diagramDoubleClick';
import type { CodeRange } from './diagramSource';
import { addNode, connect, type FlowchartWords, isFlowchart, removeNode } from './flowchartEdit';
import { isValidDiagram } from './mermaidPreview';

/**
 * Barra do nó no fluxograma (spec 06, M12–M16): clique simples num nó mostra + Passo depois, + Decisão, Ligar a…
 * e Apagar. Cada ação muda o código pelo `flowchartEdit.ts`, só se o Mermaid aceita o resultado, numa transação.
 * Como no clique duplo, o node view do Crepe para os eventos: o listener fica no `view.dom`.
 */

export type DiagramBarText = {
  step: string;
  decision: string;
  connect: string;
  remove: string;
  connectHint: string;
  failed: string;
};

export type DiagramBarConfig = { bar: DiagramBarText; words: FlowchartWords; hint: string };

export const diagramBarCtx = createSlice<DiagramBarConfig>(
  {
    bar: { step: '+ Step after', decision: '+ Decision', connect: 'Connect to…', remove: 'Delete', connectHint: 'Click the target node (Esc cancels)', failed: "Couldn't change the diagram automatically; edit the code" },
    words: { step: 'New step', decision: 'New decision?', yes: 'Yes', no: 'No' },
    hint: '',
  },
  'docsEditorDiagramBar',
);

const key = new PluginKey('docs-editor-diagram-node-bar');
const FAILED_MS = 6000;

/** Resultado de uma ação: o código novo (e o rótulo a selecionar), `null` se não há o que mudar. */
type Change = { code: string; label?: CodeRange } | null;

class NodeBar {
  private bar: HTMLElement | undefined;
  /** O nó da barra aberta ou do modo Ligar. */
  private target: { block: Element; pos: number; id: string } | undefined;
  private connecting = false;

  constructor(
    private readonly view: EditorView,
    private readonly text: () => DiagramBarConfig,
  ) {
    view.dom.addEventListener('click', this.onClick);
    view.dom.addEventListener('dblclick', this.close);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.close);
  }

  destroy() {
    this.close();
    clearTimeout(this.failTimer);
    this.view.dom.removeEventListener('click', this.onClick);
    this.view.dom.removeEventListener('dblclick', this.close);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.close);
  }

  /** O documento mudou (digitar no código, desfazer) ou virou só leitura: a barra e o modo Ligar não valem mais. */
  changed() {
    this.close();
  }

  /** Fecha a barra e cancela o modo Ligar. */
  readonly close = () => {
    this.bar?.remove();
    this.bar = undefined;
    if (this.connecting) this.stopConnecting();
    this.target = undefined;
  };

  /** O nó clicado, se é de um fluxograma num bloco de código editável. */
  private nodeAt(element: Element) {
    const gNode = element.closest('g.node');
    if (!this.view.editable || !gNode || !gNode.closest('.mermaid-diagram')) return undefined;
    const block = gNode.closest('.milkdown-code-block');
    const pos = block ? blockPosition(this.view, block) : undefined;
    const id = targetFromElement(element).nodeId;
    if (!block || pos === undefined || !id) return undefined;
    if (!isFlowchart(this.view.state.doc.nodeAt(pos)?.textContent ?? '')) return undefined;
    return { gNode, block, pos, id };
  }

  private readonly onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
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
    if (found) this.open(found);
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.bar && !this.connecting) return;
    const target = event.target;
    if (!(target instanceof Element)) return this.close();
    if (this.bar?.contains(target)) return;
    // Num nó: o click decide (outra barra, o destino do Ligar)
    if (target.closest('.mermaid-diagram g.node')) return;
    this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || (!this.bar && !this.connecting)) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private readonly onScroll = (event: Event) => {
    if (this.bar && !(event.target instanceof Node && this.bar.contains(event.target))) this.close();
  };

  private open(found: { gNode: Element; block: Element; pos: number; id: string }) {
    const { bar: text, words } = this.text();
    const target = { block: found.block, pos: found.pos, id: found.id };
    this.target = target;
    const bar = document.createElement('div');
    bar.className = 'mermaid-node-bar';
    bar.setAttribute('role', 'toolbar');
    // Os botões não tiram o foco do editor
    bar.addEventListener('pointerdown', event => event.preventDefault());
    const actions: [string, () => void][] = [
      [text.step, () => void this.run(target, code => addNode(code, target.id, 'step', words))],
      [text.decision, () => void this.run(target, code => addNode(code, target.id, 'decision', words))],
      [text.connect, () => this.startConnecting(target)],
      [text.remove, () => void this.run(target, code => ({ code: removeNode(code, target.id) }))],
    ];
    for (const [label, action] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        this.bar?.remove();
        this.bar = undefined;
        action();
      });
      bar.append(button);
    }
    // Dentro do .milkdown, onde estão as cores do tema do Crepe (fixed: a posição é a da janela)
    (this.view.dom.closest('.milkdown') ?? document.body).append(bar);
    this.bar = bar;
    // Centrada acima do nó (embaixo, se não cabe), dentro da janela
    const node = found.gNode.getBoundingClientRect();
    const { width, height } = bar.getBoundingClientRect();
    const left = Math.max(8, Math.min(node.left + node.width / 2 - width / 2, window.innerWidth - width - 8));
    const top = node.top - height - 6 >= 8 ? node.top - height - 6 : node.bottom + 6;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
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
  private async run(target: { block: Element; pos: number; id: string }, change: (code: string) => Change) {
    const { view } = this;
    const node = view.state.doc.nodeAt(target.pos);
    if (!view.editable || node?.type.name !== 'code_block') return;
    const before = node.textContent;
    const next = change(before);
    if (!next) return;
    if (next.code === before || !next.code) return this.fail(target.block);
    const valid = await isValidDiagram(next.code);
    // Mudou no meio da validação: desiste
    const now = view.state.doc.nodeAt(target.pos);
    if (!view.editable || now?.type.name !== 'code_block' || now.textContent !== before || view.nodeDOM(target.pos) !== target.block) return;
    if (!valid) return this.fail(target.block);
    const tr = view.state.tr.replaceWith(target.pos + 1, target.pos + 1 + now.content.size, view.state.schema.text(next.code));
    view.dispatch(tr);
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
