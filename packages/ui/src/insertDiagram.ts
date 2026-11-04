import { editorViewCtx } from '@milkdown/kit/core';
import { createSlice, type Ctx } from '@milkdown/kit/ctx';

/**
 * Inserir um diagrama Mermaid (spec 06, M4) pelo menu "/" e pela barra: um bloco de código `mermaid` com um
 * fluxograma curto de exemplo, que aparece desenhado (ver mermaidPreview.ts).
 */
export type DiagramInsert = {
  /** Código do exemplo, no idioma da pessoa. */
  sample: string;
  /** Avisado depois de cada inserção (a extensão configura o mkdocs.yml no primeiro diagrama, M7). */
  onInserted?: () => void;
};

export const diagramInsertCtx = createSlice<DiagramInsert>({ sample: 'flowchart LR\n  A --> B' }, 'docsEditorDiagramInsert');

/** Insere o exemplo no lugar do bloco atual, se ele está vazio, ou logo depois dele. */
export function insertDiagram(ctx: Ctx) {
  const { sample, onInserted } = ctx.get(diagramInsertCtx);
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { $from } = state.selection;
  const node = state.schema.nodes.code_block.create({ language: 'mermaid' }, state.schema.text(sample));
  const parent = $from.parent;
  const tr =
    $from.depth >= 1 && parent.isTextblock && parent.content.size === 0
      ? state.tr.replaceWith($from.before(), $from.after(), node)
      : state.tr.insert($from.depth >= 1 ? $from.after(1) : state.selection.to, node);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  onInserted?.();
}
