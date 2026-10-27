import type { Node } from '@milkdown/kit/prose/model';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';

/**
 * Transação que troca só o trecho de `current` que difere de `next` (documento recém-lido do
 * Markdown), para manter cursor, rolagem e o resto do documento como estão. Sem diferença: undefined.
 *
 * O documento lido não é igual ao do editor mesmo sem mudança de conteúdo: os títulos ainda não têm
 * `id` (um plugin preenche depois) e falta o parágrafo vazio que o editor mantém no fim. Sem tratar
 * isso, a diferença ia do primeiro título ao fim e o cursor caía no fim do documento.
 */
export function replaceChanged(state: EditorState, next: Node): Transaction | undefined {
  const current = state.doc;
  const last = current.lastChild;
  if (last?.type.name === 'paragraph' && last.content.size === 0 && !isEmptyParagraph(next.lastChild)) {
    next = next.copy(next.content.addToEnd(last.type.create()));
  }
  // Comparação sem os ids dos títulos (o tamanho dos nós não muda, as posições valem para os dois)
  const a = withoutHeadingIds(current);
  const b = withoutHeadingIds(next);
  const start = a.content.findDiffStart(b.content);
  if (start === null) return undefined;
  // Quando o começo e o fim se cruzam (texto repetido), o fim avança para não trocar um trecho negativo
  let { a: endA, b: endB } = a.content.findDiffEnd(b.content)!;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  // Dentro de um bloco de texto, troca só o trecho. Se a diferença pega estrutura (tabela, lista),
  // troca os blocos de primeiro nível inteiros: um pedaço de estrutura seria "encaixado" pelo
  // ProseMirror e podia sobrar conteúdo velho (tabela que o plugin de tabelas já tinha consertado)
  let from = start;
  const $from = a.resolve(start);
  const $to = a.resolve(endA);
  if (!($from.sameParent($to) && $from.parent.isTextblock && b.resolve(start).sameParent(b.resolve(endB)))) {
    if ($from.depth > 0) from = $from.before(1);
    if ($to.depth > 0) {
      const after = $to.after(1);
      endB += after - endA;
      endA = after;
    }
  }
  return state.tr.replace(from, endA, next.slice(from, endB));
}

function isEmptyParagraph(node: Node | null) {
  return node?.type.name === 'paragraph' && node.content.size === 0;
}

function withoutHeadingIds(doc: Node): Node {
  const json = doc.toJSON();
  const strip = (node: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (node.type === 'heading' && node.attrs) node.attrs = { ...node.attrs, id: '' };
    node.content?.forEach(child => strip(child as typeof node));
  };
  strip(json);
  return doc.type.schema.nodeFromJSON(json);
}
