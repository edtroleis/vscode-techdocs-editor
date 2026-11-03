import { $prose } from '@milkdown/kit/utils';
import type { Node as PmNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { cleanPastedHtml } from '@edtroleis/techdocs-editor-core';

/** Importa a imagem de fora para o repositório e devolve o link novo (undefined: fica o endereço de fora). */
export type ImportImage = (src: string) => Promise<string | undefined>;

/**
 * Colar HTML de outras ferramentas (spec 05). `importImage()`: quem baixa as imagens coladas (C3) — elas apontam
 * para a ferramenta de origem (que pede login, ou com endereço que expira) e no site quebrariam.
 */
export const pasteHtmlPlugin = (importImage: () => ImportImage | undefined) =>
  $prose(() => {
    const key = new PluginKey('docs-editor-paste-html');
    return new Plugin({
      key,
      props: {
        transformPastedHTML: (html, view) => {
          let title = false;
          view.state.doc.forEach(node => {
            if (node.type.name === 'heading' && node.attrs.level === 1) title = true;
          });
          return cleanPastedHtml(html, { pageHasTitle: title });
        },
        // transformPasted e não handlePaste: o plugin de colagem do Milkdown trata o evento antes e encerra
        transformPasted(slice, view) {
          const importer = importImage();
          if (!importer) return slice;
          const remote = new Set<string>();
          slice.content.descendants((node: PmNode) => {
            if (node.type.name.startsWith('image') && /^https?:/i.test(node.attrs.src ?? '')) remote.add(node.attrs.src);
          });
          // A colagem segue normal; as imagens trocam de endereço quando o download termina
          for (const src of remote) {
            void importer(src).then(link => {
              if (!link || view.isDestroyed) return;
              const tr = view.state.tr;
              view.state.doc.descendants((node, pos) => {
                if (node.type.name.startsWith('image') && node.attrs.src === src) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: link });
              });
              if (tr.docChanged) view.dispatch(tr);
            });
          }
          return slice;
        },
      },
    });
  });
