import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

/**
 * `# ` digitado no começo de um título deixava o título um nível abaixo (H1 virava H2).
 *
 * A regra de digitação do Milkdown (@milkdown/preset-commonmark, wrapInHeadingInputRule) soma os `#`
 * ao nível do título em que o cursor está. No Markdown, `# ` é sempre Título 1 e `## ` Título 2: aqui
 * o nível passa a ser o número de `#`, como num parágrafo. Este plugin vem antes das regras de
 * digitação do Milkdown, que ficam no fim da lista de plugins. Rever ao atualizar o Milkdown.
 */
const key = new PluginKey('docs-editor-heading-level-fix');

export const headingLevelFixPlugin = $prose(
  () =>
    new Plugin({
      key,
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== ' ' || from !== to) return false;
          const $from = view.state.doc.resolve(from);
          const heading = $from.parent;
          if (heading.type.name !== 'heading') return false;
          const hashes = /^#{1,6}$/.exec(heading.textBetween(0, $from.parentOffset));
          if (!hashes) return false;
          const start = $from.start();
          const tr = view.state.tr
            .delete(start, from)
            .setNodeMarkup($from.before(), undefined, { ...heading.attrs, level: hashes[0].length });
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    }),
);
