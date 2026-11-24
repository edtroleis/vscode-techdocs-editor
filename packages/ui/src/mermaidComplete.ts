import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  completionKeymap,
  snippetCompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

/**
 * Autocompletar no código dos diagramas Mermaid (spec 06, M31): no bloco `mermaid`, o editor de código sugere o tipo
 * do diagrama na primeira linha e, conforme o tipo, as palavras-chave, as formas dos nós, as setas e os nós que já
 * existem no diagrama. Segue a sintaxe de https://mermaid.js.org/syntax/flowchart.html (e das páginas dos outros
 * tipos). Os outros blocos de código ficam sem sugestão.
 */

/** Textos das sugestões: o nome de cada forma, seta e palavra-chave, pela chave (`editorText.mc.<chave>`). */
export type MermaidCompleteText = {
  /** A descrição de uma sugestão pela chave dela. */
  detail: (key: string) => string;
  /** O nome que fica selecionado num texto a escrever: "Texto". */
  text: string;
  /** Os tipos de diagrama da primeira linha: o começo do exemplo e o nome do modelo. */
  types: { header: string; label: string }[];
};

type Item = { label: string; snippet: string; key: string; boost?: number };

const s = (label: string, snippet: string, key: string, boost?: number): Item => ({ label, snippet, key, boost });

/** As formas clássicas do fluxograma, que o Mermaid 11 do Backstage desenha. Nos modelos, § é o texto a escrever. */
const SHAPES: Item[] = [
  s('[ ]', '[§]', 'shapeProcess', 10),
  s('( )', '(§)', 'shapeRound', 6),
  s('([ ])', '([§])', 'shapeStadium', 5),
  s('[[ ]]', '[[§]]', 'shapeSubroutine'),
  s('[( )]', '[(§)]', 'shapeDatabase', 4),
  s('(( ))', '((§))', 'shapeCircle'),
  s('> ]', '>§]', 'shapeFlag'),
  s('{ }', '{§}', 'shapeDecision', 8),
  s('{{ }}', '{{§}}', 'shapeHexagon'),
  s('[/ /]', '[/§/]', 'shapeInput'),
  s('[\\ \\]', '[\\§\\]', 'shapeOutput'),
  s('[/ \\]', '[/§\\]', 'shapeManual'),
  s('[\\ /]', '[\\§/]', 'shapeTrapezoid'),
  s('((( )))', '(((§)))', 'shapeDoubleCircle'),
];

const FLOW_ARROWS: Item[] = [
  s('-->', '--> ', 'arrow', 10),
  s('---', '--- ', 'line'),
  s('-.->', '-.-> ', 'dottedArrow', 6),
  s('-.-', '-.- ', 'dottedLine'),
  s('==>', '==> ', 'thickArrow', 5),
  s('===', '=== ', 'thickLine'),
  s('-- text -->', '-- § --> ', 'arrowText', 7),
  s('-->|text|', '-->|§| ', 'arrowPipeText', 4),
  s('-.text.->', '-. § .-> ', 'dottedText'),
  s('--o', '--o ', 'circleEnd'),
  s('--x', '--x ', 'crossEnd'),
  s('<-->', '<--> ', 'bothWays'),
  s('~~~', '~~~ ', 'invisible'),
];

const FLOW_KEYWORDS: Item[] = [
  s('subgraph', 'subgraph ${id}[§]\n  ${}\nend', 'subgraph', 5),
  s('end', 'end', 'end'),
  s('direction', 'direction ${LR}', 'direction'),
  s('classDef', 'classDef ${name} fill:${#fde68a},stroke:${#b45309}', 'classDef'),
  s('class', 'class ${ids} ${name}', 'class'),
  s('style', 'style ${id} fill:${#fde68a}', 'style'),
  s('linkStyle', 'linkStyle ${0} stroke:${#dc2626}', 'linkStyle'),
  s('click', 'click ${id} "${https://}"', 'click'),
  s('%%', '%% ${}', 'comment'),
];

const SEQUENCE_ARROWS: Item[] = [
  s('->>', '->>', 'seqSolid', 10),
  s('-->>', '-->>', 'seqDotted', 8),
  s('->', '->', 'seqSolidOpen'),
  s('-->', '-->', 'seqDottedOpen'),
  s('-x', '-x', 'seqCross'),
  s('--x', '--x', 'seqDottedCross'),
  s('-)', '-)', 'seqAsync'),
  s('--)', '--)', 'seqDottedAsync'),
];

const SEQUENCE_KEYWORDS: Item[] = [
  s('participant', 'participant ${id} as §', 'participant', 6),
  s('actor', 'actor ${id} as §', 'actor', 5),
  s('Note right of', 'Note right of ${A}: §', 'noteRight'),
  s('Note left of', 'Note left of ${A}: §', 'noteLeft'),
  s('Note over', 'Note over ${A},${B}: §', 'noteOver'),
  s('loop', 'loop §\n  ${}\nend', 'loop', 4),
  s('alt', 'alt §\n  ${}\nelse ${}\n  ${}\nend', 'alt', 4),
  s('opt', 'opt §\n  ${}\nend', 'opt'),
  s('par', 'par §\n  ${}\nand ${}\n  ${}\nend', 'par'),
  s('critical', 'critical §\n  ${}\nend', 'critical'),
  s('break', 'break §\n  ${}\nend', 'break'),
  s('rect', 'rect rgb(${219, 234, 254})\n  ${}\nend', 'rect'),
  s('box', 'box §\n  ${}\nend', 'box'),
  s('activate', 'activate ${A}', 'activate'),
  s('deactivate', 'deactivate ${A}', 'deactivate'),
  s('autonumber', 'autonumber', 'autonumber'),
  s('end', 'end', 'end'),
  s('%%', '%% ${}', 'comment'),
];

/** Os outros tipos: só as palavras-chave e as ligações de cada um. */
const OTHER_KEYWORDS: Record<string, Item[]> = {
  classDiagram: [
    s('class', 'class ${Name} {\n  ${+field}\n}', 'classBlock', 5),
    s('<|--', '<|-- ', 'inheritance'),
    s('*--', '*-- ', 'composition'),
    s('o--', 'o-- ', 'aggregation'),
    s('-->', '--> ', 'association'),
    s('..>', '..> ', 'dependency'),
    s('..|>', '..|> ', 'realization'),
    s('note for', 'note for ${Name} "§"', 'note'),
  ],
  stateDiagram: [
    s('[*] -->', '[*] --> ${State}', 'stateStart', 5),
    s('--> [*]', '--> [*]', 'stateEnd'),
    s('state', 'state ${Name} {\n  ${}\n}', 'stateBlock'),
    s('note right of', 'note right of ${State}\n  §\nend note', 'noteRight'),
    s('direction', 'direction ${LR}', 'direction'),
  ],
  erDiagram: [
    s('||--o{', '||--o{ ', 'erOneToMany', 5),
    s('||--|{', '||--|{ ', 'erOneToOneOrMore'),
    s('||--||', '||--|| ', 'erOneToOne'),
    s('}o--o{', '}o--o{ ', 'erManyToMany'),
    s('}|..|{', '}|..|{ ', 'erNonIdentifying'),
    s('ENTITY {', '${ENTITY} {\n  ${string} ${name}\n}', 'erEntity'),
  ],
  gantt: [
    s('title', 'title §', 'title'),
    s('dateFormat', 'dateFormat ${YYYY-MM-DD}', 'dateFormat'),
    s('axisFormat', 'axisFormat ${%d/%m}', 'axisFormat'),
    s('section', 'section §', 'section', 5),
    s('excludes', 'excludes ${weekends}', 'excludes'),
    s('task', '§ :${done}, ${t1}, ${2026-01-05}, ${3d}', 'task', 4),
  ],
  pie: [s('title', 'title §', 'title'), s('showData', 'showData', 'showData'), s('"Label" : 10', '"§" : ${10}', 'slice', 5)],
  gitGraph: [
    s('commit', 'commit', 'commit', 5),
    s('branch', 'branch ${name}', 'branch'),
    s('checkout', 'checkout ${name}', 'checkout'),
    s('merge', 'merge ${name}', 'merge'),
    s('cherry-pick', 'cherry-pick id: "${id}"', 'cherryPick'),
  ],
  journey: [s('title', 'title §', 'title'), s('section', 'section §', 'section', 5), s('task', '§: ${5}: ${Me}', 'journeyTask', 4)],
  timeline: [s('title', 'title §', 'title'), s('section', 'section §', 'section', 5), s('event', '${2026} : §', 'event', 4)],
};

/** O tipo pela primeira linha que conta (sem o front matter `---` e os comentários `%%`). */
function diagramType(state: EditorState): { type: string | undefined; headerLine: number } {
  let inFront = false;
  for (let n = 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text.trim();
    if (n === 1 && text === '---') {
      inFront = true;
      continue;
    }
    if (inFront) {
      if (text === '---') inFront = false;
      continue;
    }
    if (!text || text.startsWith('%%')) continue;
    return { type: text.split(/\s+/)[0].replace(/-v2$/, ''), headerLine: n };
  }
  return { type: undefined, headerLine: 0 };
}

/** Os nós do fluxograma: o id e o texto da primeira vez que ele aparece com forma. */
function flowNodes(doc: string): Map<string, string> {
  const nodes = new Map<string, string>();
  const shaped = /(?:^|[\s;&>|-])([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(\(|\(\(|\(\[|\[\/|\[\\|\{\{|\[|\(|\{|>)(?:"([^"]*)"|([^\])}"\n]*))/g;
  for (const m of doc.matchAll(shaped)) if (!nodes.has(m[1])) nodes.set(m[1], (m[3] ?? m[4] ?? '').replace(/[/\\]$/, '').trim());
  const KEYWORDS = /^(flowchart|graph|subgraph|end|direction|classDef|class|style|linkStyle|click|TD|TB|LR|RL|BT)$/;
  for (const m of doc.matchAll(/(?:^|-->|---|==>|-\.->|~~~|\|[^|\n]*\|)[ \t]*([A-Za-z_][\w-]*)\b(?![ \t]*[[({>])/gm))
    if (!KEYWORDS.test(m[1]) && !nodes.has(m[1])) nodes.set(m[1], '');
  return nodes;
}

/** Os participantes da sequência: os declarados e os que aparecem nas mensagens. */
function participants(doc: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of doc.matchAll(/^\s*(?:participant|actor)\s+([^\s:]+)(?:\s+as\s+(.+))?$/gm)) found.set(m[1], (m[2] ?? '').trim());
  for (const m of doc.matchAll(/^\s*([^\s:>-]+)\s*--?(?:>>|>|x|\))\s*([^\s:]+)\s*:/gm))
    for (const id of [m[1], m[2]]) if (!found.has(id)) found.set(id, '');
  return found;
}

/** Fora de colchetes, parênteses, chaves e aspas: ali dentro é o texto do nó, sem sugestão. */
function outsideText(before: string) {
  let depth = 0;
  let quoted = false;
  for (const ch of before) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && '[({'.includes(ch)) depth++;
    else if (!quoted && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
  }
  return depth === 0 && !quoted;
}

/** A fonte das sugestões (separada para os testes, que não têm o bloco do editor). */
export function mermaidCompletionSource(text: () => MermaidCompleteText) {
  const option = (item: Item): Completion => {
    const t = text();
    const template = item.snippet.replace('§', `\${${t.text}}`);
    return snippetCompletion(template, { label: item.label, detail: t.detail(item.key), boost: item.boost, type: 'keyword' });
  };
  /** Seta sem texto a escrever: depois dela a lista volta, com os nós (o CodeMirror só abre a lista ao digitar). */
  const arrowOption = (item: Item): Completion => {
    const base = option(item);
    if (item.snippet.includes('§')) return base;
    return {
      ...base,
      apply: (view, completion, from, to) => {
        (base.apply as (...args: Parameters<Exclude<Completion['apply'], string | undefined>>) => void)(view, completion, from, to);
        setTimeout(() => startCompletion(view));
      },
    };
  };
  const ids = (nodes: Map<string, string>, after = ''): Completion[] =>
    [...nodes].map(([id, label]) => ({ label: id, detail: label || undefined, apply: id + after, type: 'variable', boost: 20 }));

  const source = (context: CompletionContext): CompletionResult | null => {
    // Só nos blocos mermaid (a classe vem do mermaidBlockClass): os outros blocos de código ficam como estão
    if (context.view && !context.view.dom.closest('.mermaid-block')) return null;
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from);
    const word = context.matchBefore(/[\w-]*$/);
    const { type, headerLine } = diagramType(state);

    // Primeira linha: o tipo do diagrama
    if (!type || line.number <= headerLine) {
      if (!/^\s*[\w-]*$/.test(before)) return null;
      if (!context.explicit && !word?.text) return null;
      const t = text();
      const seen = new Set<string>();
      const options = t.types
        .filter(({ header }) => !seen.has(header) && seen.add(header))
        .map(({ header, label }, i) => ({ label: header, detail: label, type: 'class', boost: -i / 100 }));
      for (const extra of ['flowchart TD', 'flowchart LR'])
        if (!seen.has(extra)) options.push({ label: extra, detail: t.detail('flowchart'), type: 'class', boost: 0 });
      return { from: word ? word.from : pos, options, validFor: /^[\w-]*$/ };
    }

    if (type === 'flowchart' || type === 'graph') {
      if (!outsideText(before.replace(/(\[\[|\[\(|\(\(\(|\(\(|\(\[|\[\/|\[\\|\{\{|\[|\(|\{|>)$/, ''))) return null;
      // Forma: o colchete, parêntese ou chave logo depois do id do nó
      const shape = /[A-Za-z_][\w-]*([[({>][[(/\\({]?)$/.exec(before);
      if (shape) {
        const closing = /^[\])}]{0,3}/.exec(line.text.slice(pos - line.from))![0];
        return { from: pos - shape[1].length, to: pos + closing.length, options: SHAPES.map(option), filter: true };
      }
      // Depois de uma seta: os nós que já existem
      const afterArrow = /(?:-->|---|==>|===|-\.->|-\.-|~~~|--o|--x|<-->|\|[^|]*\||--\s[^-]*-->)\s+([\w-]*)$/.exec(before);
      if (afterArrow) return { from: pos - afterArrow[1].length, options: ids(flowNodes(state.doc.toString())), validFor: /^[\w-]*$/ };
      // Depois de um nó: as setas (com o primeiro caractere de uma, ou Ctrl+Espaço)
      const arrow = /[\w\])}>]\s+([-=.~<][-=.~<>|ox]*|)$/.exec(before);
      if (arrow && /\S/.test(before.slice(0, before.length - arrow[1].length)) && (arrow[1] || context.explicit))
        return { from: pos - arrow[1].length, options: FLOW_ARROWS.map(arrowOption) };
      // Começo da linha: os nós e as palavras-chave
      if (/^\s*[\w%-]*$/.test(before) && (word?.text || context.explicit))
        return { from: word ? word.from : pos, options: [...ids(flowNodes(state.doc.toString()), ' '), ...FLOW_KEYWORDS.map(option)], validFor: /^[\w%-]*$/ };
      return null;
    }

    if (type === 'sequenceDiagram') {
      if (/:/.test(before)) return null;
      const afterArrow = /--?(?:>>|>|x|\))\s*([\w-]*)$/.exec(before);
      if (afterArrow) return { from: pos - afterArrow[1].length, options: ids(participants(state.doc.toString()), ': ') };
      const arrow = /^\s*[^\s:>-]+\s*([-]+[->x)]*)$/.exec(before);
      if (arrow && arrow[1]) return { from: pos - arrow[1].length, options: SEQUENCE_ARROWS.map(arrowOption) };
      if (/^\s*[\w%-]*$/.test(before) && (word?.text || context.explicit))
        return { from: word ? word.from : pos, options: [...ids(participants(state.doc.toString())), ...SEQUENCE_KEYWORDS.map(option)], validFor: /^[\w%-]*$/ };
      return null;
    }

    const keywords = OTHER_KEYWORDS[type];
    const token = context.matchBefore(/\S*$/);
    if (!keywords || (!token?.text && !context.explicit)) return null;
    return { from: token ? token.from : pos, options: keywords.map(option) };
  };

  return source;
}

export function mermaidCompletion(text: () => MermaidCompleteText): Extension {
  const source = mermaidCompletionSource(text);
  return [
    EditorState.languageData.of(() => [{ autocomplete: source }]),
    // O Crepe põe o Enter do bloco de código (nova linha) antes do basicSetup: sem isto, Enter com a lista aberta
    // quebrava a linha em vez de escolher. As teclas da lista só agem com ela aberta
    Prec.highest(keymap.of(completionKeymap)),
  ];
}
