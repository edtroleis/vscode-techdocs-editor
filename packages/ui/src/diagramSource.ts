/**
 * Onde, no código de um diagrama Mermaid, está o que a pessoa clicou no desenho (spec 06, M10). Sem DOM e sem o
 * Mermaid: o clique duplo usa para levar o cursor ao trecho, e montar fluxogramas com o mouse vai reaproveitar.
 */

/** O que foi clicado: o texto do rótulo e, no fluxograma, a id do nó. */
export type DiagramTarget = { nodeId?: string; text: string };

/** Trecho no texto do diagrama (0 = início do código). */
export type CodeRange = { from: number; to: number };

export type Line = { text: string; start: number };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\p{L}\\p{N}_]';
/** A id como palavra inteira: nem `node` dentro de `my-node` (o hífen das setas `A-->B` continua valendo). */
export const idPattern = (id: string) => `(?<!${WORD}-?)${escape(id)}(?!${WORD})`;

/** As linhas depois da do tipo (front matter, linhas vazias e comentários antes dela ficam de fora). */
export function bodyLines(code: string): { type: string; lines: Line[] } {
  const lines: Line[] = [];
  let start = 0;
  for (const text of code.split('\n')) {
    lines.push({ text, start });
    start += text.length + 1;
  }
  let i = 0;
  if (lines[0]?.text.trim() === '---') {
    i = lines.findIndex((l, k) => k > 0 && l.text.trim() === '---') + 1;
    if (i === 0) return { type: '', lines: [] };
  }
  while (i < lines.length && (!lines[i].text.trim() || lines[i].text.trim().startsWith('%%'))) i++;
  return { type: lines[i]?.text.trim() ?? '', lines: lines.slice(i + 1) };
}

/** Formas do fluxograma, das mais longas para as mais curtas, com o fechamento. */
const SHAPES: [string, string][] = [
  ['[[', ']]'], ['[(', ')]'], ['([', '])'], ['((', '))'], ['{{', '}}'], ['[/', ']'], ['[\\', ']'],
  ['[', ']'], ['(', ')'], ['{', '}'], ['>', ']'],
];

/** O rótulo do nó `id` na linha, sem os espaços e as aspas das pontas. */
function shapeLabel(line: Line, id: string): CodeRange | undefined {
  const re = new RegExp(idPattern(id), 'gu');
  for (const match of line.text.matchAll(re)) {
    const after = match.index + match[0].length;
    const shape = SHAPES.find(([open]) => line.text.startsWith(open, after));
    if (!shape) continue;
    let from = after + shape[0].length;
    const close = line.text.indexOf(shape[1], from);
    if (close < 0) continue;
    let to = close;
    // Fechamentos de [/ ] e [\ ] levam a barra
    if (shape[0].length === 2 && shape[1] === ']' && /[/\\]/.test(line.text[to - 1] ?? '')) to--;
    while (from < to && /[\s"]/.test(line.text[from])) from++;
    while (to > from && /[\s"]/.test(line.text[to - 1])) to--;
    return { from: line.start + from, to: line.start + to };
  }
  return undefined;
}

function findWord(lines: Line[], id: string): CodeRange | undefined {
  const re = new RegExp(idPattern(id), 'u');
  for (const line of lines) {
    const match = re.exec(line.text);
    if (match) return { from: line.start + match.index, to: line.start + match.index + id.length };
  }
  return undefined;
}

function findText(lines: Line[], text: string): CodeRange | undefined {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  // Palavra inteira nas pontas que são letras ou números ("A" não casa no "a" de "participant")
  const before = new RegExp(`^${WORD}`, 'u').test(words[0]) ? `(?<!${WORD})` : '';
  const after = new RegExp(`${WORD}$`, 'u').test(words.at(-1)!) ? `(?!${WORD})` : '';
  const source = before + words.map(escape).join('\\s+') + after;
  // Primeiro com as maiúsculas exatas, depois ignorando a caixa
  for (const flags of ['u', 'iu']) {
    const re = new RegExp(source, flags);
    for (const line of lines) {
      const match = re.exec(line.text);
      if (match) return { from: line.start + match.index, to: line.start + match.index + match[0].length };
    }
  }
  return undefined;
}

/**
 * O trecho do código do que foi clicado. Fluxograma com id: o rótulo do nó (ou a id, se ele não tem forma);
 * senão, a primeira ocorrência do texto depois da linha do tipo. `undefined` se não achou.
 */
export function locateInDiagram(code: string, target: DiagramTarget): CodeRange | undefined {
  const { type, lines } = bodyLines(code);
  if (target.nodeId && /^(flowchart|graph)\b/.test(type)) {
    for (const line of lines) {
      const label = shapeLabel(line, target.nodeId);
      if (label) return label;
    }
    const word = findWord(lines, target.nodeId);
    if (word) return word;
  }
  return findText(lines, target.text);
}
