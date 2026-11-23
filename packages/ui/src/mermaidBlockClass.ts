import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';

/**
 * Marca os blocos de código `mermaid` com a classe `mermaid-block` (decoração no DOM do node view do Crepe). O CSS
 * esconde neles o seletor de linguagem: trocar a linguagem de um diagrama apaga o desenho, e quem quer mesmo isso
 * troca o `mermaid` da cerca no editor de texto.
 */
const key = new PluginKey<DecorationSet>('docs-editor-mermaid-block-class');

function decorate(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      if (String(node.attrs.language ?? '').trim().toLowerCase() === 'mermaid')
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'mermaid-block' }));
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

export const mermaidBlockClassPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
      },
      props: { decorations: state => key.getState(state) },
    }),
);
