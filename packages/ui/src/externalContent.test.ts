import { Node, Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { tableNodes } from '@milkdown/kit/prose/tables';
import { replaceChanged } from './externalContent';

// Schema mínimo com o que importa aqui: títulos com id (preenchido depois, no editor) e tabelas
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    heading: { group: 'block', content: 'text*', attrs: { id: { default: '' } } },
    text: {},
    ...tableNodes({ tableGroup: 'block', cellContent: 'paragraph+', cellAttributes: {} }),
  },
});

const p = (text = '') => schema.node('paragraph', null, text ? schema.text(text) : []);
const h = (text: string, id = '') => schema.node('heading', { id }, schema.text(text));
const cell = (text: string) => schema.node('table_cell', null, p(text));
const row = (...cells: string[]) => schema.node('table_row', null, cells.map(cell));
const table = (...rows: string[][]) => schema.node('table', null, rows.map(cells => row(...cells)));
const doc = (...blocks: Node[]) => schema.node('doc', null, blocks);

function apply(current: Node, next: Node, cursor?: number) {
  let state = EditorState.create({ doc: current });
  if (cursor !== undefined) state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor)));
  const tr = replaceChanged(state, next);
  return tr ? state.apply(tr) : state;
}

/** Posição logo depois de `text` no documento. */
function after(node: Node, text: string) {
  let found = -1;
  node.descendants((child, pos) => {
    if (found < 0 && child.isText && child.text!.includes(text)) found = pos + child.text!.indexOf(text) + text.length;
  });
  return found;
}

describe('replaceChanged', () => {
  it('sem mudança de conteúdo, não troca nada (mesmo com os ids dos títulos e o parágrafo final)', () => {
    const current = doc(h('Título', 'titulo'), p('um'), p());
    expect(replaceChanged(EditorState.create({ doc: current }), doc(h('Título'), p('um')))).toBeUndefined();
  });

  it('troca só o trecho e mantém o cursor e os ids dos títulos', () => {
    const current = doc(h('Título', 'titulo'), p('um marcadorx marcadorz'), h('Outro', 'outro'), p());
    const state = apply(current, doc(h('Título'), p('um marcadorx'), h('Outro')), after(current, 'marcadorz'));
    expect(state.doc.eq(doc(h('Título', 'titulo'), p('um marcadorx'), h('Outro', 'outro'), p()))).toBe(true);
    expect(state.selection.from).toBe(after(state.doc, 'marcadorx'));
  });

  it('desfaz texto que entrou no fim do parágrafo seguido de título', () => {
    const current = doc(h('Título', 'titulo'), p('um marcadorum marcadordois'), h('Outro', 'outro'), p('fim'), p());
    const state = apply(current, doc(h('Título'), p('um marcadorum'), h('Outro'), p('fim')));
    expect(state.doc.eq(doc(h('Título', 'titulo'), p('um marcadorum'), h('Outro', 'outro'), p('fim'), p()))).toBe(true);
  });

  it('texto repetido: o fim não passa do começo', () => {
    const state = apply(doc(p('aa')), doc(p('aaa')));
    expect(state.doc.eq(doc(p('aaa')))).toBe(true);
  });

  it('tabela consertada pelo editor volta inteira ao conteúdo lido', () => {
    // O editor acrescentou a célula que faltava no cabeçalho; o conteúdo lido não tem a célula extra
    const current = doc(p('antes'), table(['1', '2', ''], ['7', '8', 'marcadortexto']), p());
    const state = apply(current, doc(p('antes'), table(['1', '2'], ['7', '8'])));
    expect(state.doc.eq(doc(p('antes'), table(['1', '2'], ['7', '8']), p()))).toBe(true);
  });

  it('mudança em vários blocos', () => {
    const state = apply(doc(p('a'), p('b'), p('c')), doc(p('a'), p('x'), p('y'), p('c')));
    expect(state.doc.eq(doc(p('a'), p('x'), p('y'), p('c')))).toBe(true);
  });

  it('documento esvaziado', () => {
    const state = apply(doc(p('a'), p('b')), doc(p()));
    expect(state.doc.eq(doc(p()))).toBe(true);
  });
});
