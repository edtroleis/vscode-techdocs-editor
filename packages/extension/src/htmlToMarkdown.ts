import { fromHtml } from 'hast-util-from-html';
import { toMdast } from 'hast-util-to-mdast';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import { DOMParser as LightDOMParser } from 'linkedom';
import { STRINGIFY_OPTIONS, cleanPastedHtml, fromEditor } from '@edtroleis/techdocs-editor-core';

/** Grava a imagem de fora no repositório e devolve o link para a página (undefined: fica o endereço de fora). */
export type ImportImage = (src: string) => Promise<string | undefined>;

type MdNode = { type: string; url?: string; children?: MdNode[] };

/**
 * HTML colado (do Confluence, do Outline, de uma página web) → Markdown do repositório, com as mesmas limpezas do
 * editor visual (spec 05) e os mesmos ajustes ao salvar (`fromEditor`: avisos do MkDocs, `&` e `@` sem barra,
 * tabelas largas compactas). As imagens de fora passam por `importImage` (C3).
 */
export async function htmlToMarkdown(html: string, options: { pageHasTitle?: boolean; importImage?: ImportImage } = {}): Promise<string> {
  const cleaned = cleanPastedHtml(html, {
    pageHasTitle: options.pageHasTitle,
    // O DOM leve: no processo das extensões não há navegador
    parse: text => new LightDOMParser().parseFromString(`<!doctype html><html><body>${text}</body></html>`, 'text/html') as unknown as Document,
  });
  const tree = toMdast(fromHtml(cleaned, { fragment: true })) as MdNode;
  if (options.importImage) {
    const images: MdNode[] = [];
    const walk = (node: MdNode) => {
      if (node.type === 'image' && /^https?:/i.test(node.url ?? '')) images.push(node);
      node.children?.forEach(walk);
    };
    walk(tree);
    const links = new Map<string, Promise<string | undefined>>();
    for (const image of images) {
      if (!links.has(image.url!)) links.set(image.url!, options.importImage(image.url!));
      image.url = (await links.get(image.url!)) ?? image.url;
    }
  }
  const markdown = toMarkdown(tree as Parameters<typeof toMarkdown>[0], { ...STRINGIFY_OPTIONS, extensions: [gfmToMarkdown()] });
  return fromEditor(markdown);
}
