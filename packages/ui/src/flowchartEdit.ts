/**
 * Mudar um fluxograma Mermaid pelo código, linha a linha (spec 06, M13–M15): a barra do nó acrescenta passos e
 * decisões, liga e apaga nós. Sem DOM e sem o Mermaid; quem chama valida o resultado com o parse do Mermaid.
 */
import { bodyLines, type CodeRange, idPattern } from './diagramSource';

export type FlowchartWords = { step: string; decision: string; yes: string; no: string };

/**
 * Setas de qualquer comprimento (`-->`, `--->`, `---`, `===`, `==>`, `-.-`, `-.->`, `~~~`), com as pontas `<`, `o`
 * e `x`, com texto no meio (`-- x -->`, `== x ==>`, `-. x .->`) ou `|texto|` depois.
 */
const ARROW = new RegExp(
  String.raw`\s*(?:<|(?<=\s)[ox])?(?:--\s+(?:(?!--).)+?\s+(?:-{2,}[>ox]|-{3,})|==\s+(?:(?!==).)+?\s+(?:={2,}[>ox]|={3,})|-\.\s+(?:(?!\.-).)+?\s+\.-+>?|-{2,}[>ox]|-{3,}|={2,}[>ox]|={3,}|-\.+->?|~{3,})(?:\s*\|[^|]*\|)?\s*`,
  'gu',
);
const ID = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*/u;

/** Os pedaços de um comando separados pelas setas, e as setas (com os espaços) entre eles. */
function split(text: string): { pieces: string[]; arrows: string[] } {
  const body = text.trim().replace(/;\s*$/, '');
  const pieces: string[] = [];
  const arrows: string[] = [];
  let last = 0;
  for (const m of body.matchAll(ARROW)) {
    pieces.push(body.slice(last, m.index).trim());
    arrows.push(m[0]);
    last = m.index + m[0].length;
  }
  pieces.push(body.slice(last).trim());
  return { pieces, arrows };
}

const pieceId = (piece: string) => ID.exec(piece)?.[0];

/** O texto sem o que está dentro das formas, das aspas e dos `|rótulos|` (onde `&`, `;` e ids não contam). */
const outsideLabels = (text: string) => text.replace(/"[^"]*"|\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|\|[^|]*\|/g, ' ');

export function isFlowchart(code: string): boolean {
  return /^(flowchart|graph)\b/.test(bodyLines(code).type);
}

const isDecision = (code: string, id: string) => new RegExp(`${idPattern(id)}\\{(?!\\{)`, 'u').test(code);

/** Quantas setas saem de `from`, e se já há uma de `from` para `to`. */
function arrowsFrom(code: string, from: string, to?: string): { count: number; exists: boolean } {
  let count = 0;
  let exists = false;
  for (const line of bodyLines(code).lines) {
    const { pieces } = split(line.text);
    for (let i = 0; i + 1 < pieces.length; i++) {
      if (pieceId(pieces[i]) !== from) continue;
      count++;
      if (to !== undefined && pieceId(pieces[i + 1]) === to) exists = true;
    }
  }
  return { count, exists };
}

function freeId(code: string): string {
  for (let k = 1; ; k++) if (!new RegExp(idPattern(`N${k}`), 'u').test(code)) return `N${k}`;
}

/** Acrescenta `text` numa linha nova no fim, com o recuo da última linha do corpo; devolve onde ela começa. */
function appendLine(code: string, text: string): { code: string; at: number } {
  const lines = bodyLines(code).lines.filter((l) => l.text.trim());
  const indent = lines.length ? /^\s*/.exec(lines.at(-1)!.text)![0] : '  ';
  const tail = /\s*$/.exec(code)![0];
  const head = code.slice(0, code.length - tail.length) + '\n' + indent;
  return { code: head + text + tail, at: head.length };
}

function arrowTo(code: string, from: string, words: FlowchartWords): string {
  if (!isDecision(code, from)) return ' --> ';
  const { count } = arrowsFrom(code, from);
  const label = count === 0 ? words.yes : count === 1 ? words.no : undefined;
  return label ? ` -- ${label} --> ` : ' --> ';
}

/**
 * As formas da barra do nó (spec 06, M33), todas desenhadas pelo Mermaid 11 do TechDocs. O documento usa a
 * sintaxe nova `@{ shape: doc }` (Mermaid 11.3+); as outras, os delimitadores de sempre.
 */
export const SHAPES = ['step', 'start', 'decision', 'database', 'io', 'doc', 'subroutine', 'prep', 'round', 'circle'] as const;
export type ShapeKey = (typeof SHAPES)[number];

const DELIMITERS: Record<Exclude<ShapeKey, 'doc'>, [string, string]> = {
  step: ['[', ']'],
  start: ['([', '])'],
  decision: ['{', '}'],
  database: ['[(', ')]'],
  io: ['[/', '/]'],
  subroutine: ['[[', ']]'],
  prep: ['{{', '}}'],
  round: ['(', ')'],
  circle: ['((', '))'],
};

/** Os delimitadores que o Mermaid aceita, dos mais longos aos mais curtos, com a forma da barra (se há uma). */
const KNOWN: [string, string, ShapeKey | undefined][] = [
  ['(((', ')))', undefined],
  ['([', '])', 'start'],
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'database'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'prep'],
  ['[/', '/]', 'io'],
  ['[\\', '\\]', undefined],
  ['[/', '\\]', undefined],
  ['[\\', '/]', undefined],
  ['>', ']', undefined],
  ['[', ']', 'step'],
  ['(', ')', 'round'],
  ['{', '}', 'decision'],
];

/** A forma de um pedaço (`A[texto]:::x`): o texto de dentro, como está escrito, e o que vem depois. */
type Shaped = { shape: ShapeKey | undefined; inner: string; suffix: string; bare: boolean };

function shapeOf(piece: string, id: string): Shaped {
  const rest = piece.slice(id.length);
  const cls = /:::[\p{L}\p{N}_-]+$/u.exec(rest);
  const suffix = cls ? cls[0] : '';
  const body = cls ? rest.slice(0, cls.index) : rest;
  if (!body) return { shape: undefined, inner: id, suffix, bare: true };
  const at = /^@\{([\s\S]*)\}$/.exec(body);
  if (at) {
    const shape = /shape:\s*([\w-]+)/.exec(at[1])?.[1];
    const label = /label:\s*"([^"]*)"/.exec(at[1])?.[1] ?? /label:\s*([^,}]+)/.exec(at[1])?.[1]?.trim() ?? id;
    return { shape: shape === 'doc' || shape === 'document' ? 'doc' : undefined, inner: label, suffix, bare: false };
  }
  for (const [open, close, shape] of KNOWN)
    if (body.startsWith(open) && body.endsWith(close) && body.length >= open.length + close.length)
      return { shape, inner: body.slice(open.length, body.length - close.length), suffix, bare: false };
  return { shape: undefined, inner: body, suffix, bare: false };
}

/** O texto do nó sem as aspas. */
const unquote = (inner: string) => (/^"[\s\S]*"$/.test(inner) ? inner.slice(1, -1) : inner);

/** A forma escrita com o texto, e onde o texto fica nela. */
function wrap(shape: ShapeKey, inner: string): { text: string; label: CodeRange } {
  if (shape === 'doc') {
    const label = unquote(inner).replace(/"/g, '#quot;');
    const head = '@{ shape: doc, label: "';
    return { text: `${head}${label}" }`, label: { from: head.length, to: head.length + label.length } };
  }
  const [open, close] = DELIMITERS[shape];
  // Texto com os caracteres das formas, sem aspas: com aspas, para o Mermaid não confundir
  const safe = /^"[\s\S]*"$/.test(inner) || !/[[\](){}<>/\\|]/.test(inner) ? inner : `"${inner.replace(/"/g, '#quot;')}"`;
  const offset = safe.startsWith('"') ? 1 : 0;
  return { text: open + safe + close, label: { from: open.length + offset, to: open.length + safe.length - offset } };
}

/** Uma linha do corpo partida em pedaços e setas, para montar de novo. */
type Parsed = { index: number; indent: string; semi: boolean; pieces: string[]; arrows: string[] };

/** As linhas que dá para mudar com segurança: sem `&`, sem vários comandos, sem comentário. */
function parsedLines(code: string): { all: string[]; parsed: Parsed[] } {
  const { lines } = bodyLines(code);
  const all = code.split('\n');
  const first = all.length - lines.length;
  const parsed: Parsed[] = [];
  lines.forEach(({ text }, k) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('%%')) return;
    if (/^(subgraph|end|style|classDef|class|click|linkStyle|direction)\b/.test(trimmed)) return;
    const bare = outsideLabels(text).trim().replace(/;$/, '');
    if (/[;&]/.test(bare)) return;
    const { pieces, arrows } = split(text);
    parsed.push({ index: first + k, indent: /^\s*/.exec(text)![0], semi: /;\s*$/.test(trimmed), pieces, arrows });
  });
  return { all, parsed };
}

const join = (p: Parsed) => p.indent + p.pieces.map((piece, i) => (i ? p.arrows[i - 1] + piece : piece)).join('') + (p.semi ? ';' : '');

/** Onde começa a linha `index` no código. */
const lineStart = (all: string[], index: number) => all.slice(0, index).reduce((n, l) => n + l.length + 1, 0);

/** A forma do nó `id` no código (a última definição vale, como no Mermaid). */
export function nodeShape(code: string, id: string): ShapeKey | undefined {
  let found: ShapeKey | undefined = 'step';
  for (const p of parsedLines(code).parsed)
    for (const piece of p.pieces) if (pieceId(piece) === id && !shapeOf(piece, id).bare) found = shapeOf(piece, id).shape;
  return found;
}

/**
 * Troca a forma do nó (M33): onde ele tem forma, troca os delimitadores e mantém o texto e o `:::classe`; se o nó
 * só aparece sem forma (`A --> B`), a primeira vez ganha a forma com a id como texto. Sem onde mudar com
 * segurança, devolve o código igual.
 */
export function setShape(code: string, id: string, shape: ShapeKey): string {
  const { all, parsed } = parsedLines(code);
  let changed = false;
  for (const p of parsed)
    p.pieces.forEach((piece, i) => {
      if (pieceId(piece) !== id) return;
      const s = shapeOf(piece, id);
      if (s.bare) return;
      p.pieces[i] = id + wrap(shape, s.inner).text + s.suffix;
      all[p.index] = join(p);
      changed = true;
    });
  if (changed) return all.join('\n');
  for (const p of parsed) {
    const i = p.pieces.findIndex(piece => pieceId(piece) === id);
    if (i < 0) continue;
    const s = shapeOf(p.pieces[i], id);
    p.pieces[i] = id + wrap(shape, id).text + s.suffix;
    all[p.index] = join(p);
    return all.join('\n');
  }
  return code;
}

export function addNode(code: string, from: string, kind: ShapeKey, words: FlowchartWords): { code: string; label: CodeRange } {
  const id = freeId(code);
  const { text, label } = wrap(kind, kind === 'decision' ? words.decision : words.step);
  const start = from + arrowTo(code, from, words) + id;
  const r = appendLine(code, start + text);
  const at = r.at + start.length;
  return { code: r.code, label: { from: at + label.from, to: at + label.to } };
}

/** Os estilos de linha da barra da seta (M34). */
export const LINE_STYLES = ['normal', 'dotted', 'thick', 'open', 'both'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];
const TOKENS: Record<LineStyle, string> = { normal: '-->', dotted: '-.->', thick: '==>', open: '---', both: '<-->' };

/** Uma seta do código: a linha, a posição entre os pedaços e de onde a quem vai. */
type EdgeAt = { line: Parsed; i: number };

/**
 * A seta de número `index` (a ordem do desenho: o Mermaid numera as setas na ordem do código), conferindo que vai
 * de `from` a `to`. Linhas com `&` ou vários comandos contam as setas delas, mas não se mudam.
 */
function edgeAt(code: string, index: number, from: string, to: string): { all: string[]; edge: EdgeAt } | undefined {
  const { lines } = bodyLines(code);
  const { all, parsed } = parsedLines(code);
  const first = all.length - lines.length;
  let n = 0;
  for (let k = 0; k < lines.length; k++) {
    const p = parsed.find(x => x.index === first + k);
    if (!p) {
      // Linha que não se muda: conta as setas dela (cada `&` multiplica)
      const text = lines[k].text.trim();
      if (!text || text.startsWith('%%') || /^(subgraph|end|style|classDef|class|click|linkStyle|direction)\b/.test(text)) continue;
      for (const statement of outsideLabels(text).split(';')) {
        const { pieces } = split(statement);
        for (let i = 0; i + 1 < pieces.length; i++) n += pieces[i].split('&').length * pieces[i + 1].split('&').length;
      }
      if (n > index) return undefined;
      continue;
    }
    for (let i = 0; i + 1 < p.pieces.length; i++, n++)
      if (n === index) return pieceId(p.pieces[i]) === from && pieceId(p.pieces[i + 1]) === to ? { all, edge: { line: p, i } } : undefined;
  }
  return undefined;
}

/** O que a seta escrita tem: o estilo e o texto (de `|texto|` ou do meio, `-- texto -->`). */
function arrowParts(arrow: string): { style: LineStyle; label: string | undefined } {
  const piped = /\|([^|]*)\|/.exec(arrow);
  const body = arrow.replace(/\|[^|]*\|/, '').trim();
  const middle = /^(?:<)?(?:--|==|-\.)\s+(.+?)\s+(?:-{2,}|={2,}|\.-+)[>ox]?$/.exec(body);
  const label = piped ? piped[1] : middle?.[1];
  const token = middle ? body.replace(middle[1], '') : body;
  const head = /[>ox]$/.test(token);
  const style: LineStyle = token.startsWith('<') && head ? 'both' : token.includes('=') ? 'thick' : token.includes('.') ? 'dotted' : head ? 'normal' : 'open';
  return { style, label };
}

const writeArrow = (style: LineStyle, label: string | undefined) => ` ${TOKENS[style]}${label === undefined ? '' : `|${label}|`} `;

/** O estilo da seta `index`, para marcar o atual no menu. */
export function edgeStyle(code: string, index: number, from: string, to: string): LineStyle | undefined {
  const found = edgeAt(code, index, from, to);
  return found && arrowParts(found.edge.line.arrows[found.edge.i]).style;
}

export function setEdgeStyle(code: string, index: number, from: string, to: string, style: LineStyle): string | undefined {
  const found = edgeAt(code, index, from, to);
  if (!found) return undefined;
  const { all, edge } = found;
  edge.line.arrows[edge.i] = writeArrow(style, arrowParts(edge.line.arrows[edge.i]).label);
  all[edge.line.index] = join(edge.line);
  return all.join('\n');
}

/** O texto da seta selecionado para escrever: o que já tem, ou `placeholder` novo em `|…|`. */
export function edgeLabel(code: string, index: number, from: string, to: string, placeholder: string): { code: string; label: CodeRange } | undefined {
  const found = edgeAt(code, index, from, to);
  if (!found) return undefined;
  const { all, edge } = found;
  const { style, label } = arrowParts(edge.line.arrows[edge.i]);
  const text = label ?? placeholder;
  edge.line.arrows[edge.i] = writeArrow(style, text);
  all[edge.line.index] = join(edge.line);
  const before = edge.line.indent + edge.line.pieces.slice(0, edge.i + 1).map((piece, i) => (i ? edge.line.arrows[i - 1] + piece : piece)).join('');
  const at = lineStart(all, edge.line.index) + before.length + ` ${TOKENS[style]}|`.length;
  return { code: all.join('\n'), label: { from: at, to: at + text.length } };
}

/** Tira a seta; os pedaços de cada lado viram linhas (nenhum nó some, e as definições ficam). */
export function removeEdge(code: string, index: number, from: string, to: string): string | undefined {
  const found = edgeAt(code, index, from, to);
  if (!found) return undefined;
  const { all, edge } = found;
  const { line, i } = edge;
  const side = (pieces: string[], arrows: string[]) => ({ ...line, semi: false, pieces, arrows });
  const left = side(line.pieces.slice(0, i + 1), line.arrows.slice(0, i));
  const right = side(line.pieces.slice(i + 1), line.arrows.slice(i + 1));
  const used = (p: Parsed) => {
    // Um nó sozinho, sem forma, que aparece em outro lugar: a linha não acrescenta nada
    if (p.pieces.length > 1) return true;
    const only = p.pieces[0];
    const id = pieceId(only);
    if (id !== only) return true;
    return !all.some((l, j) => j !== line.index && new RegExp(idPattern(id), 'u').test(outsideLabels(l)));
  };
  all.splice(line.index, 1, ...[left, right].filter(used).map(join));
  return all.join('\n');
}

/** A seta passa a ir de `to` a `from`, com o mesmo estilo e texto. */
export function reverseEdge(code: string, index: number, from: string, to: string): string | undefined {
  const found = edgeAt(code, index, from, to);
  if (!found) return undefined;
  const arrow = found.edge.line.arrows[found.edge.i];
  const removed = removeEdge(code, index, from, to);
  if (removed === undefined) return undefined;
  const { style, label } = arrowParts(arrow);
  return appendLine(removed, to + writeArrow(style, label) + from).code;
}

export function connect(code: string, from: string, to: string, words: FlowchartWords): string | undefined {
  if (from === to || arrowsFrom(code, from, to).exists) return undefined;
  return appendLine(code, from + arrowTo(code, from, words) + to).code;
}

/**
 * Tira o nó, as setas ligadas a ele e as linhas style/class/click dele; os pedaços de cada lado viram linhas.
 * Linhas com `&`, vários comandos (`;`) ou setas que não entendo, citando o nó, voltam o código igual.
 */
export function removeNode(code: string, id: string): string {
  const { lines } = bodyLines(code);
  const word = new RegExp(idPattern(id), 'u');
  const all = code.split('\n');
  const first = all.length - lines.length;
  for (let k = lines.length - 1; k >= 0; k--) {
    const { text } = lines[k];
    if (!word.test(text) || text.trim().startsWith('%%')) continue;
    const indent = /^\s*/.exec(text)![0];
    const meta = /^(style|class|click)\s+([^\s]+)(.*)$/.exec(text.trim());
    let next: string[];
    if (meta) {
      const ids = meta[2].split(',');
      if (!ids.includes(id)) continue;
      const rest = ids.filter((x) => x !== id);
      next = meta[1] !== 'style' && rest.length ? [indent + `${meta[1]} ${rest.join(',')}${meta[3]}`] : [];
    } else {
      const bare = outsideLabels(text);
      if (!word.test(bare)) continue;
      // Vários comandos (`;`) ou nós (`&`) na linha: não dá para mudar com segurança
      if (/[;&]/.test(bare.trim().replace(/;$/, ''))) return code;
      const { pieces, arrows } = split(text);
      // A id está na linha fora de um pedaço que eu entendo (seta desconhecida): não mexe
      if (!pieces.some((p) => pieceId(p) === id)) return code;
      next = [];
      let run = '';
      pieces.forEach((p, i) => {
        if (pieceId(p) === id) {
          if (run) next.push(indent + run);
          run = '';
        } else run = run ? run + arrows[i - 1] + p : p;
      });
      if (run) next.push(indent + run);
      // Pedaço que ficou só com a id de um nó que tem forma em outra linha não acrescenta nada
      next = next.filter((l) => {
        const bare = l.trim();
        const shaped = new RegExp(`${idPattern(bare)}[[({>]`, 'u');
        return pieceId(bare) !== bare || !all.some((o, j) => j !== first + k && shaped.test(o));
      });
    }
    all.splice(first + k, 1, ...next);
  }
  return all.join('\n');
}
