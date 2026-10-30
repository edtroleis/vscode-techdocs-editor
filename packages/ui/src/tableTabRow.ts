import { $prose } from '@milkdown/kit/utils';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { isInTable, selectedRect } from '@milkdown/kit/prose/tables';

/**
 * Tab na última célula da tabela cria uma linha nova e leva o cursor para a primeira célula dela,
 * como no Word, no Notion e no GitHub. O Milkdown só anda entre as células: na última, o Tab não
 * fazia nada e o que vinha depois caía todo na mesma célula. As células novas copiam os atributos
 * das de cima (o alinhamento da coluna).
 */
const key = new PluginKey('docs-editor-table-tab-row');

export const tableTabRowPlugin = $prose(
  () =>
    new Plugin({
      key,
      props: {
        handleKeyDown(view, event) {
          if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
          const { state } = view;
          if (!isInTable(state)) return false;
          const rect = selectedRect(state);
          if (rect.bottom !== rect.map.height || rect.right !== rect.map.width) return false;
          const lastRow = rect.table.child(rect.map.height - 1);
          const cells: Node[] = [];
          lastRow.forEach(cell => cells.push(cell.type.createAndFill(cell.attrs)!));
          const rowPos = rect.tableStart + rect.table.content.size;
          const tr = state.tr.insert(rowPos, lastRow.type.create(lastRow.attrs, cells));
          // rowPos: começo da linha nova; +1 entra na linha, +1 na célula, +1 no parágrafo
          tr.setSelection(TextSelection.near(tr.doc.resolve(rowPos + 3)));
          view.dispatch(tr.scrollIntoView());
          event.preventDefault();
          return true;
        },
      },
    }),
);
