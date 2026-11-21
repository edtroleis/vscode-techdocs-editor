import { EditorView as CodeView } from '@codemirror/view';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { locateInDiagram, type DiagramTarget } from './diagramSource';

/**
 * Clique duplo num texto do desenho Mermaid leva ao código (spec 06, M10). O bloco de código do Crepe fica como
 * está: o clique duplo aperta o botão Editar dele e seleciona o trecho direto no CodeMirror do bloco (o Crepe
 * guarda a seleção no ProseMirror a partir dela). O node view para todos os eventos (`stopEvent`), então o
 * `handleDOMEvents` não recebe o clique: o listener fica no `view.dom`. Rever ao atualizar o Milkdown (classes
 * `preview-toggle-button` e `codemirror-host`).
 */
const key = new PluginKey('docs-editor-diagram-double-click');

const LABEL = 'foreignObject, text, .nodeLabel, .edgeLabel, .label';
/** Id dos nós do fluxograma no SVG do Mermaid: `flowchart-<id>-<n>`, às vezes com o id do desenho antes. */
const NODE_ID = /(?:^|-)flowchart-(.+)-\d+$/;

/** O texto do rótulo clicado e, no fluxograma, a id do nó. */
export function targetFromElement(element: Element): DiagramTarget {
  const label = element.closest(LABEL) ?? element;
  const text = (label.textContent ?? '').replace(/\s+/g, ' ').trim();
  const nodeId = element.closest('g.node')?.id.match(NODE_ID)?.[1];
  return nodeId ? { nodeId, text } : { text };
}

/** A posição do bloco de código cujo DOM é `dom`. */
function blockPosition(view: EditorView, dom: Element): number | undefined {
  let found: number | undefined;
  view.state.doc.descendants((node, pos) => {
    if (found !== undefined) return false;
    if (node.type.name === 'code_block' && view.nodeDOM(pos) === dom) found = pos;
    return node.type.name !== 'code_block';
  });
  return found;
}

function onDoubleClick(view: EditorView, event: MouseEvent) {
  const target = event.target;
  if (!view.editable || !(target instanceof Element) || !target.closest('.mermaid-diagram')) return;
  const block = target.closest('.milkdown-code-block');
  const pos = block ? blockPosition(view, block) : undefined;
  if (!block || pos === undefined) return;
  event.preventDefault();
  // O texto do nó agora, não o do desenho (que pode estar atrasado)
  const code = view.state.doc.nodeAt(pos)?.textContent ?? '';
  const range = locateInDiagram(code, targetFromElement(target)) ?? { from: 0, to: 0 };
  const select = () => {
    const dom = block.querySelector<HTMLElement>('.cm-editor');
    const editor = dom && CodeView.findFromDOM(dom);
    if (!editor || editor.state.doc.toString() !== code) return;
    editor.focus();
    editor.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
  };
  // Na hora, sem esperar um quadro: a tecla seguinte não pode chegar antes da seleção (no CI chegava)
  const hidden = () => block.querySelector('.codemirror-host')?.classList.contains('hidden') ?? true;
  if (!hidden()) return select();
  block.querySelector<HTMLElement>('.preview-toggle-button')?.click();
  // O Vue mostra o código numa microtarefa agendada pelo clique; esta roda depois dela (se ainda não, no quadro seguinte)
  queueMicrotask(() => (hidden() ? requestAnimationFrame(select) : select()));
}

export const diagramDoubleClickPlugin = $prose(
  () =>
    new Plugin({
      key,
      view: view => {
        const listener = (event: MouseEvent) => onDoubleClick(view, event);
        view.dom.addEventListener('dblclick', listener);
        return { destroy: () => view.dom.removeEventListener('dblclick', listener) };
      },
    }),
);
