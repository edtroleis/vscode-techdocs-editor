import { isMap, isScalar, isSeq, parseDocument, type Node, type YAMLMap, type YAMLSeq } from 'yaml';

/** Bloco de diagrama Mermaid de uma página: o código e a linha (1-based) em que ele começa no arquivo. */
export type MermaidBlock = { line: number; code: string };

/** Blocos cercados com a linguagem `mermaid` (crases ou tis), fora de outros blocos de código. */
export function mermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: string | undefined;
  let current: { line: number; code: string[] } | undefined;
  lines.forEach((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        if (current) blocks.push({ line: current.line, code: current.code.join('\n') });
        fence = undefined;
        current = undefined;
      } else {
        current?.code.push(line);
      }
    } else if (marker) {
      fence = marker[1];
      if (/^mermaid(\s|$)/i.test(marker[2].trim())) current = { line: index + 2, code: [] };
    }
  });
  return blocks;
}

const SUPERFENCES = 'pymdownx.superfences';

/** Entrada do `custom_fences` (spec 06), com as linhas a partir da coluna 0. */
const MERMAID_FENCE = ['- name: mermaid', '  class: mermaid', '  format: !!python/name:pymdownx.superfences.fence_code_format'];

const indent = (lines: string[], spaces: number) => lines.map(l => ' '.repeat(spaces) + l).join('\n') + '\n';

/** Item `pymdownx.superfences` (texto puro ou mapa) da lista `markdown_extensions`. */
function superfencesItem(seq: YAMLSeq): Node | undefined {
  return seq.items.find(item => {
    if (isScalar(item)) return item.value === SUPERFENCES;
    return isMap(item) && item.has(SUPERFENCES);
  }) as Node | undefined;
}

/** O `markdown_extensions` tem o bloco personalizado `mermaid` no `pymdownx.superfences`. */
export function hasMermaidFence(yml: string): boolean {
  const doc = parseDocument(yml);
  const extensions = doc.get('markdown_extensions', true);
  if (!isSeq(extensions)) return false;
  const item = superfencesItem(extensions);
  if (!isMap(item)) return false;
  const fences = (item.get(SUPERFENCES, true) as YAMLMap | undefined)?.get?.('custom_fences', true);
  return isSeq(fences) && fences.items.some(f => isMap(f) && f.get('name') === 'mermaid');
}

/** Coluna do começo da linha em que `offset` está. */
const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;
/** Coluna de `offset` na linha dele. */
const column = (text: string, offset: number) => offset - lineStart(text, offset);
/** Começo da linha depois do conteúdo que termina em `offset` (o fim do texto, com uma quebra, se for a última). */
function afterLine(text: string, offset: number): { text: string; at: number } {
  const newline = text.indexOf('\n', Math.max(offset - 1, 0));
  if (newline === -1) return { text: `${text}\n`, at: text.length + 1 };
  return { text, at: newline + 1 };
}
const insertAt = (text: string, offset: number, piece: string) => {
  const target = afterLine(text, offset);
  return target.text.slice(0, target.at) + piece + target.text.slice(target.at);
};

/**
 * Acrescenta ao `mkdocs.yml` a configuração do Mermaid da spec 06 (o bloco `mermaid` do `pymdownx.superfences`).
 * Mexe só no trecho novo: o resto do texto (comentários, tags do MkDocs) fica igual. Aplicar de novo não muda nada.
 */
export function addMermaidFence(yml: string): string {
  if (hasMermaidFence(yml)) return yml;
  const doc = parseDocument(yml);
  const extensions = doc.get('markdown_extensions', true);
  const entry = (spaces: number) => indent(MERMAID_FENCE, spaces);
  const superfences = (spaces: number) =>
    indent([`- ${SUPERFENCES}:`, '    custom_fences:'], spaces) + entry(spaces + 6);

  // Sem a chave: ela inteira no fim
  if (!doc.has('markdown_extensions')) return `${yml && !yml.endsWith('\n') ? `${yml}\n` : yml}markdown_extensions:\n${superfences(2)}`;
  if (!isSeq(extensions) || !extensions.items.length || extensions.flow) return rewrite(doc);

  const dash = (node: Node) => column(yml, node.range![0]) - 2;
  const first = extensions.items[0] as Node;
  const item = superfencesItem(extensions);

  // Sem o superfences: um item novo no fim da lista
  if (!item) return insertAt(yml, extensions.range![1], superfences(dash(first)));

  // `- pymdownx.superfences` sem opções: a linha vira o item com as opções
  if (isScalar(item)) {
    const start = lineStart(yml, item.range![0]);
    const end = afterLine(yml, item.range![1]);
    return end.text.slice(0, start) + superfences(dash(item)) + end.text.slice(end.at);
  }

  const options = (item as YAMLMap).get(SUPERFENCES, true);
  if (isMap(options) && !options.flow && options.items.length) {
    const fences = options.get('custom_fences', true);
    // Já tem outros blocos: a entrada no fim da lista
    if (isSeq(fences) && !fences.flow && fences.items.length) {
      return insertAt(yml, fences.range![1], entry(column(yml, (fences.items[0] as Node).range![0]) - 2));
    }
    // Outras opções, sem custom_fences: a chave no fim do mapa
    if (!options.has('custom_fences')) {
      const key = options.items[0].key as Node;
      const spaces = column(yml, key.range![0]);
      return insertAt(yml, options.range![1], indent(['custom_fences:'], spaces) + entry(spaces + 2));
    }
  }

  return rewrite(doc);
}

/** Formas raras (listas numa linha, valores vazios): acerta pela árvore do `yaml` e reescreve o arquivo. */
function rewrite(doc: ReturnType<typeof parseDocument>): string {
  let extensions: unknown = doc.get('markdown_extensions', true);
  if (!isSeq(extensions)) {
    extensions = doc.createNode([]) as YAMLSeq;
    doc.set('markdown_extensions', extensions);
  }
  const seq = extensions as YAMLSeq;
  // Em bloco, como o resto do arquivo costuma estar (o `yaml` mantém a forma de uma linha se ela já era assim)
  seq.flow = false;
  let item = superfencesItem(seq);
  if (!isMap(item)) {
    const fresh = doc.createNode({ [SUPERFENCES]: null }) as YAMLMap;
    if (item) seq.items[seq.items.indexOf(item as never)] = fresh as never;
    else seq.items.push(fresh as never);
    item = fresh;
  }
  const map = item as YAMLMap;
  let options: unknown = map.get(SUPERFENCES, true);
  if (!isMap(options)) {
    options = doc.createNode({}) as YAMLMap;
    map.set(SUPERFENCES, options);
  }
  let list: unknown = (options as YAMLMap).get('custom_fences', true);
  if (!isSeq(list)) {
    list = doc.createNode([]) as YAMLSeq;
    (options as YAMLMap).set('custom_fences', list);
  }
  const format = doc.createNode('');
  (format as { tag?: string }).tag = 'tag:yaml.org,2002:python/name:pymdownx.superfences.fence_code_format';
  (list as YAMLSeq).items.push(doc.createNode({ name: 'mermaid', class: 'mermaid', format }) as never);
  for (const node of [seq, ...seq.items]) if (isMap(node) || isSeq(node)) node.flow = false;
  return doc.toString().replace(/(!!python\/name:[\w.]+) ""/g, '$1');
}
