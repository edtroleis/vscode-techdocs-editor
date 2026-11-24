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

/**
 * O Título 1 é o nome da página (lint MD025): um Título 1 novo numa página que já tem um vira Título 2, venha da
 * barra, do menu "/", de `# ` ou de colar. Só os títulos que viraram Título 1 nesta edição: abrir um arquivo com
 * dois Títulos 1 não muda nada, e o texto que chega do arquivo (editor de texto, Git) também não (`EXTERNAL_CHANGE`).
 */
const singleKey = new PluginKey('docs-editor-single-h1');

/** Meta da transação com o texto que chegou do arquivo: o visual mostra o que está lá, sem ajustar. */
export const EXTERNAL_CHANGE = 'docs-editor-external-change';

export const singleTitlePlugin = $prose(
  () =>
    new Plugin({
      key: singleKey,
      appendTransaction(transactions, oldState, newState) {
        if (!transactions.some(tr => tr.docChanged) || transactions.some(tr => tr.getMeta(EXTERNAL_CHANGE))) return null;
        const before = new Set<number>();
        oldState.doc.forEach((node, pos) => {
          if (node.type.name !== 'heading' || node.attrs.level !== 1) return;
          let mapped = pos;
          for (const tr of transactions) mapped = tr.mapping.map(mapped, 1);
          before.add(mapped);
        });
        const h1: { pos: number; fresh: boolean }[] = [];
        newState.doc.forEach((node, pos) => {
          if (node.type.name === 'heading' && node.attrs.level === 1) h1.push({ pos, fresh: !before.has(pos) });
        });
        if (h1.length < 2 || !h1.some(h => h.fresh)) return null;
        // Sem Título 1 antigo, o primeiro dos novos fica
        const keep = h1.some(h => !h.fresh) ? undefined : h1[0].pos;
        const tr = newState.tr;
        for (const { pos, fresh } of h1) {
          if (fresh && pos !== keep) tr.setNodeMarkup(pos, undefined, { ...newState.doc.nodeAt(pos)!.attrs, level: 2 });
        }
        return tr.docChanged ? tr : null;
      },
    }),
);
