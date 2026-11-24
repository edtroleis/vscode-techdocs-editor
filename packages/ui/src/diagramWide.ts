import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { blockPosition } from './diagramDoubleClick';
import { turnTopDown } from './mermaidPreview';

/**
 * Os botões do aviso de diagrama largo (spec 06, M32): "Ver como no Backstage" mostra o desenho na largura da página
 * do TechDocs (e volta), e "Desenhar de cima para baixo" troca `LR`/`RL` por `TD` no código, numa transação (um
 * Ctrl+Z desfaz). Os botões vêm na prévia, que o Crepe copia como HTML (sem listeners): o clique é tratado aqui.
 */
const key = new PluginKey('docs-editor-diagram-wide');

export const diagramWidePlugin = $prose(
  () =>
    new Plugin({
      key,
      view: view => {
        const button = (event: Event) =>
          event.target instanceof Element ? event.target.closest<HTMLElement>('.mermaid-wide-size, .mermaid-wide-turn') : null;
        // Sem o mousedown, o ProseMirror põe o cursor no bloco
        const onMouseDown = (event: MouseEvent) => {
          if (!button(event) || !view.dom.contains(event.target as Node)) return;
          event.preventDefault();
          event.stopPropagation();
        };
        const onClick = (event: MouseEvent) => {
          const target = button(event);
          if (!target || !view.dom.contains(target)) return;
          event.preventDefault();
          event.stopPropagation();
          if (target.classList.contains('mermaid-wide-size')) {
            const diagram = target.closest('.mermaid-view');
            const on = !diagram?.classList.contains('mermaid-as-techdocs');
            diagram?.classList.toggle('mermaid-as-techdocs', on);
            target.textContent = (on ? target.dataset.asEditor : target.dataset.asTechdocs) ?? target.textContent;
            target.setAttribute('aria-pressed', String(on));
            return;
          }
          if (!view.editable) return;
          const block = target.closest('.milkdown-code-block');
          const pos = block ? blockPosition(view, block) : undefined;
          const node = pos === undefined ? null : view.state.doc.nodeAt(pos);
          if (pos === undefined || !node) return;
          const code = node.textContent;
          const turned = turnTopDown(code);
          if (turned === code) return;
          view.dispatch(view.state.tr.replaceWith(pos + 1, pos + node.nodeSize - 1, view.state.schema.text(turned)));
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
