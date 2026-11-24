import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Mark, Node } from '@milkdown/kit/prose/model';
import { type EditorState, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip';

/**
 * Botão e glossário do TechDocs no editor visual (spec 01, M1). Os dois já voltam iguais ao salvar (o Markdown deles
 * é texto comum para o editor): aqui só ganham a cara do Backstage, com decorações.
 * - Botão: `[Texto](endereço){ .md-button }` (attr_list do Material); o link aparece como botão e o `{ .md-button }`
 *   some, a não ser com o cursor no parágrafo.
 * - Glossário: `Termo` e, na linha de baixo, `:   Significado` (def_list); o termo em negrito e o significado
 *   recuado, sem o `:`, a não ser com o cursor no parágrafo.
 */

/** Os atributos depois do link: `{ .md-button }`, `{ .md-button .md-button--primary }`, com outras classes juntas. */
const BUTTON_ATTRS = /^\{\s*((?:[.#][\w-]+|[\w-]+="[^"]*")\s*)+\}/;
const isButton = (attrs: string) => /(^|\s|\{)\.md-button(\s|\})/.test(attrs);
const isPrimary = (attrs: string) => /\.md-button--primary\b/.test(attrs);
/** O começo da linha do significado: `:` e o recuo até o texto. */
const DEFINITION = /^:(?: {1,3}|\t)(?=\S)/;

const isSoftBreak = (node: Node) => node.type.name === 'hardbreak' && node.attrs.isInline;

/** As linhas do parágrafo (separadas por quebra simples): o começo e o fim de cada uma e o texto. */
function lines(block: Node, start: number) {
  const out: { from: number; to: number; text: string }[] = [];
  let from = start;
  let text = '';
  block.forEach((child, offset) => {
    const pos = start + offset;
    if (isSoftBreak(child)) {
      out.push({ from, to: pos, text });
      from = pos + child.nodeSize;
      text = '';
    } else text += child.isText ? child.text : '￼';
  });
  out.push({ from, to: start + block.content.size, text });
  return out;
}

function decorate(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const { $from, $to } = state.selection;
  state.doc.descendants((block, pos) => {
    if (!block.isTextblock) return true;
    if (block.type.name === 'code_block') return false;
    const start = pos + 1;
    const editing = $from.start() === start || $to.start() === start;
    // Botão: um link seguido dos atributos com .md-button
    let link: { mark: Mark; from: number } | undefined;
    block.forEach((child, offset) => {
      const at = start + offset;
      const mark = child.marks.find(m => m.type.name === 'link');
      if (mark) {
        if (!link || link.mark !== mark) link = { mark, from: at };
        return;
      }
      const attrs = child.isText ? BUTTON_ATTRS.exec(child.text!)?.[0] : undefined;
      if (link && attrs && isButton(attrs)) {
        decorations.push(
          Decoration.inline(link.from, at, { class: `td-md-button${isPrimary(attrs) ? ' td-md-button--primary' : ''}` }),
          Decoration.inline(at, at + attrs.length, { class: editing ? 'td-attrs' : 'td-attrs td-hidden' }),
        );
      }
      link = undefined;
    });
    // Glossário: o termo na primeira linha e o significado nas de baixo
    const all = lines(block, start);
    if (all.length > 1 && all[0].text.trim() && !DEFINITION.test(all[0].text) && DEFINITION.test(all[1].text)) {
      decorations.push(Decoration.node(pos, pos + block.nodeSize, { class: 'td-deflist' }));
      for (const line of all) {
        const mark = DEFINITION.exec(line.text)?.[0];
        if (mark) decorations.push(Decoration.inline(line.from, line.from + mark.length, { class: editing ? 'td-dd-mark' : 'td-dd-mark td-hidden' }));
        else if (line.text.trim() && line.to > line.from) decorations.push(Decoration.inline(line.from, line.to, { class: 'td-dt' }));
      }
    }
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

const key = new PluginKey<DecorationSet>('techdocs-inline');

export const techdocsInlinePlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => decorate(state),
        apply: (tr, value, _old, state) => (tr.docChanged || tr.selectionSet ? decorate(state) : value),
      },
      props: { decorations: state => key.getState(state) },
    }),
);

// ---------------------------------------------------------------------------------------------------------------
// Inserir pelo menu "/" (o parágrafo do cursor já está vazio: o "/" saiu)

function replaceParagraph(ctx: Ctx, content: Node[]) {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { $from } = state.selection;
  const from = $from.depth ? $from.before() : $from.pos;
  const to = $from.depth ? $from.after() : $from.pos;
  const tr = state.tr.replaceWith(from, to, state.schema.nodes.paragraph.create(null, content));
  return { view, tr, start: from + 1 };
}

/** O botão: o link com o texto selecionado e a caixa do endereço aberta (com as páginas do site). */
export function insertButton(ctx: Ctx, label: string) {
  const { schema } = ctx.get(editorViewCtx).state;
  const mark = schema.marks.link.create({ href: '' });
  const { view, tr, start } = replaceParagraph(ctx, [schema.text(label, [mark]), schema.text('{ .md-button }')]);
  tr.setSelection(TextSelection.create(tr.doc, start, start + label.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  ctx.get(linkTooltipAPI.key).editLink(mark, start, start + label.length);
}

/** O glossário: o termo (selecionado, pronto para trocar) e o significado na linha de baixo. */
export function insertGlossary(ctx: Ctx, term: string, meaning: string) {
  const { schema } = ctx.get(editorViewCtx).state;
  const { view, tr, start } = replaceParagraph(ctx, [
    schema.text(term),
    schema.nodes.hardbreak.create({ isInline: true }),
    schema.text(`:   ${meaning}`),
  ]);
  tr.setSelection(TextSelection.create(tr.doc, start, start + term.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** O link para outra doc: a caixa de link aberta no cursor, com as docs do Backstage na lista. */
export function insertDocLink(ctx: Ctx) {
  const view = ctx.get(editorViewCtx);
  const { from } = view.state.selection;
  view.focus();
  ctx.get(linkTooltipAPI.key).addLink(from, from);
}
