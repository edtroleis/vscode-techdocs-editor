import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { blockPosition } from './diagramDoubleClick';
import { TRASH_ICON } from './mermaidPreview';

/**
 * Botão Excluir do diagrama (spec 06, M30): apaga o bloco de código inteiro numa transação (um Ctrl+Z traz de volta).
 * Fica na barra do bloco, ao lado do Editar e do Ver diagrama, no desenho e no código. A barra é do Crepe: o botão é
 * posto (e reposto, se o Crepe a refizer) quando um bloco é `mermaid`, e o clique é tratado aqui, por delegação.
 */
const key = new PluginKey('docs-editor-diagram-delete');

export type DiagramDeleteText = { remove: string; removeShort: string };

/** Põe o Excluir na barra dos blocos `mermaid` e tira dos outros (a linguagem pode mudar). */
function syncButtons(root: HTMLElement, text: DiagramDeleteText) {
  for (const block of root.querySelectorAll<HTMLElement>('.milkdown-code-block')) {
    const group = block.querySelector<HTMLElement>('.tools .tools-button-group');
    if (!group) continue;
    const mermaid = block.querySelector('.language-button')?.textContent?.trim().toLowerCase() === 'mermaid';
    let button = group.querySelector<HTMLButtonElement>(':scope > .mermaid-delete');
    if (!mermaid) {
      button?.remove();
      continue;
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'mermaid-delete';
      group.append(button);
    }
    if (button.title !== text.remove) {
      button.title = text.remove;
      button.setAttribute('aria-label', text.remove);
      button.innerHTML = `<span class="milkdown-icon">${TRASH_ICON}</span>`;
      button.append(text.removeShort);
    }
  }
}

export const diagramDeletePlugin = (text: () => DiagramDeleteText) =>
  $prose(
    () =>
      new Plugin({
        key,
        view: view => {
          // A barra do bloco é refeita pelo Crepe (troca de linguagem, Editar/Ver diagrama): confere a cada mudança
          const observer = new MutationObserver(() => syncButtons(view.dom, text()));
          observer.observe(view.dom, { childList: true, subtree: true, characterData: true });
          syncButtons(view.dom, text());
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
            update: () => syncButtons(view.dom, text()),
            destroy: () => {
              observer.disconnect();
              document.removeEventListener('mousedown', onMouseDown, true);
              document.removeEventListener('click', onClick, true);
            },
          };
        },
      }),
  );
