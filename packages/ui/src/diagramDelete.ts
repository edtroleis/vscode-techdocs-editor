import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { blockPosition } from './diagramDoubleClick';

/**
 * Botão Excluir do diagrama (spec 06, M30): apaga o bloco de código inteiro numa transação (um Ctrl+Z traz de volta).
 * O botão vem na prévia, que o Crepe copia como HTML (sem listeners): o clique é tratado aqui, por delegação.
 */
const key = new PluginKey('docs-editor-diagram-delete');

export const diagramDeletePlugin = $prose(
  () =>
    new Plugin({
      key,
      view: view => {
        const button = (event: Event) =>
          event.target instanceof Element ? event.target.closest<HTMLElement>('.mermaid-delete') : null;
        // Sem o mousedown, o ProseMirror põe o cursor no bloco
        const onMouseDown = (event: MouseEvent) => {
          if (!button(event) || !view.dom.contains(event.target as Node)) return;
          event.preventDefault();
          event.stopPropagation();
        };
        const onClick = (event: MouseEvent) => {
          const target = button(event);
          if (!target || !view.dom.contains(target) || !view.editable) return;
          event.preventDefault();
          event.stopPropagation();
          const block = target.closest('.milkdown-code-block');
          const pos = block ? blockPosition(view, block) : undefined;
          const node = pos === undefined ? null : view.state.doc.nodeAt(pos);
          if (pos === undefined || !node) return;
          view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
          view.focus();
        };
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('click', onClick, true);
        return {
          destroy: () => {
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('click', onClick, true);
          },
        };
      },
    }),
);
