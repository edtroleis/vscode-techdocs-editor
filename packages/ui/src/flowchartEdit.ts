/**
 * Mudar um fluxograma Mermaid pelo código, linha a linha (spec 06, M13–M15): a barra do nó acrescenta passos e
 * decisões, liga e apaga nós. Sem DOM e sem o Mermaid; quem chama valida o resultado com o parse do Mermaid.
 */
import { bodyLines, type CodeRange, idPattern } from './diagramSource';

export type FlowchartWords = { step: string; decision: string; yes: string; no: string };

/** Setas: com texto no meio (`-- x -->`, `== x ==>`, `-. x .->`) ou simples, com `|texto|` opcional depois. */
const ARROW = new RegExp(
  String.raw`\s*<?(?:--\s+[^-|]+?\s+-->|==\s+[^=|]+?\s+==>|-\.\s+.+?\s+\.->|-->|---|-\.->|==>|--o(?![\p{L}\p{N}_])|--x(?![\p{L}\p{N}_]))(?:\s*\|[^|]*\|)?\s*`,
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

export function addNode(code: string, from: string, kind: 'step' | 'decision', words: FlowchartWords): { code: string; label: CodeRange } {
  const id = freeId(code);
  const [open, text, close] = kind === 'step' ? ['[', words.step, ']'] : ['{', words.decision, '}'];
  const start = from + arrowTo(code, from, words) + id + open;
  const r = appendLine(code, start + text + close);
  const labelFrom = r.at + start.length;
  return { code: r.code, label: { from: labelFrom, to: labelFrom + text.length } };
}

export function connect(code: string, from: string, to: string, words: FlowchartWords): string | undefined {
  if (from === to || arrowsFrom(code, from, to).exists) return undefined;
  return appendLine(code, from + arrowTo(code, from, words) + to).code;
}

/**
 * Tira o nó, as setas ligadas a ele e as linhas style/class/click dele; os pedaços de cada lado viram linhas.
 * Linhas com `&` que citam o nó não dão para mudar com segurança: o código volta igual.
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
      const { pieces, arrows } = split(text);
      if (!pieces.some((p) => pieceId(p) === id)) continue;
      if (pieces.some((p) => /(^|\s)&(\s|$)/.test(p))) return code;
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
