import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';

/**
 * Texto alternativo das imagens sozinhas no parágrafo (o bloco de imagem do Crepe).
 *
 * O Crepe guarda no lugar do texto alternativo o tamanho do bloco na tela: `![Diagrama](a.png)` era
 * gravado como `![1.00](a.png)`, e a descrição da imagem se perdia. Aqui o texto alternativo fica como
 * estava; o tamanho não vai para o arquivo (o MkDocs não usa). Imagem sem texto alternativo usa a
 * legenda, que é o campo que a pessoa vê no editor (a legenda continua no título da imagem); imagem
 * recém-enviada sem legenda usa o nome do arquivo, como o GitHub (`uploadedName`). Sem nenhum dos dois,
 * o lint aponta a imagem sem texto alternativo (MD045).
 */
export const imageAltPlugin = (uploadedName: (src: string) => string | undefined): MilkdownPlugin => ctx => {
  // Antes de o schema ser montado: o bloco de imagem lê a definição desta fatia ao montar
  ctx.update(imageBlockSchema.key, base => c => {
    const schema = base(c);
    return {
      ...schema,
      attrs: { ...schema.attrs, alt: { default: '', validate: 'string' } },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          state.addNode(type, {
            src: node.url as string,
            caption: (node.title as string | null) ?? '',
            alt: (node.alt as string | null) ?? '',
          });
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          state.openNode('paragraph');
          state.addNode('image', undefined, undefined, {
            title: node.attrs.caption,
            url: node.attrs.src,
            alt: node.attrs.alt || node.attrs.caption || uploadedName(node.attrs.src) || '',
          });
          state.closeNode();
        },
      },
    };
  });
  return () => {};
};
