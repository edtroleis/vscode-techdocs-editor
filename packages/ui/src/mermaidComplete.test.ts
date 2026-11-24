import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { editorTextFrom } from './labels';
import { mermaidCompletionSource } from './mermaidComplete';
import { en } from './messages/en';
import { ptBR } from './messages/pt-BR';

const lookup = (messages: Record<string, string>) => (key: string) => messages[key] ?? `?${key}`;
const source = mermaidCompletionSource(() => editorTextFrom(lookup(en)).diagram.complete);

/** O código com `‸` onde está o cursor; devolve as sugestões (rótulo e o que entra) e de onde elas trocam. */
function suggest(code: string, explicit = false) {
  const pos = code.indexOf('‸');
  const state = EditorState.create({ doc: code.replace('‸', '') });
  const result = source(new CompletionContext(state, pos, explicit));
  if (!result) return undefined;
  return {
    from: result.from,
    to: result.to,
    labels: result.options.map(o => o.label),
    details: result.options.map(o => o.detail),
    apply: (label: string) => {
      const option = result.options.find(o => o.label === label)!;
      return typeof option.apply === 'string' ? option.apply : '(snippet)';
    },
  };
}

describe('autocompletar do Mermaid (M31)', () => {
  it('primeira linha: os tipos de diagrama, pelos modelos', () => {
    const r = suggest('seq‸')!;
    expect(r.labels).toContain('sequenceDiagram');
    expect(r.labels).toContain('flowchart TD');
    expect(r.details[r.labels.indexOf('sequenceDiagram')]).toBe('Sequence');
    expect(r.from).toBe(0);
  });

  it('fluxograma: as formas depois do id do nó, trocando o colchete que o editor fechou sozinho', () => {
    const r = suggest('flowchart LR\n  A[Start] --> B[‸]')!;
    expect(r.labels).toEqual(expect.arrayContaining(['[ ]', '[( )]', '{ }', '([ ])', '[[ ]]', '{{ }}', '[/ /]', '((( )))']));
    expect(r.details[r.labels.indexOf('[( )]')]).toBe('Database (cylinder)');
    const line = 'flowchart LR\n  A[Start] --> B['.length;
    expect([r.from, r.to]).toEqual([line - 1, line + 1]);
  });

  it('fluxograma: dentro do texto do nó, nada', () => {
    expect(suggest('flowchart LR\n  A[New st‸]')).toBeUndefined();
    expect(suggest('flowchart LR\n  A["a (b) c‸"]')).toBeUndefined();
  });

  it('fluxograma: as setas depois de um nó, com o primeiro caractere ou Ctrl+Espaço', () => {
    expect(suggest('flowchart LR\n  A[Start] ‸')).toBeUndefined();
    expect(suggest('flowchart LR\n  A[Start] ‸', true)!.labels).toContain('-->');
    const r = suggest('flowchart LR\n  A[Start] -‸')!;
    expect(r.labels).toEqual(expect.arrayContaining(['-->', '-.->', '==>', '-- text -->', '--o', '--x', '<-->', '~~~']));
    expect(r.details[r.labels.indexOf('-.->')]).toBe('Dotted arrow');
  });

  it('fluxograma: depois da seta, os nós que já existem, com o texto deles', () => {
    const r = suggest('flowchart LR\n  A[Start] --> B{Decision}\n  B --> C[(Orders DB)]\n  A --> ‸')!;
    expect(r.labels).toEqual(['A', 'B', 'C']);
    expect(r.details).toEqual(['Start', 'Decision', 'Orders DB']);
    expect(suggest('flowchart LR\n  A[Start] -- Yes --> ‸')!.labels).toEqual(['A']);
    expect(suggest('flowchart LR\n  A[Start] -->|Yes| ‸')!.labels).toEqual(['A']);
  });

  it('fluxograma: começo da linha, os nós e as palavras-chave (subgraph, classDef…)', () => {
    const r = suggest('flowchart LR\n  Web[Web app] --> Api\n  s‸')!;
    expect(r.labels).toEqual(expect.arrayContaining(['Web', 'Api', 'subgraph', 'style', 'classDef']));
    expect(r.apply('Web')).toBe('Web ');
  });

  it('sequência: participantes, setas e blocos', () => {
    const doc = 'sequenceDiagram\n  participant A as Alice\n  A->>Bob: Hi\n';
    expect(suggest(`${doc}  l‸`)!.labels).toEqual(expect.arrayContaining(['loop', 'A', 'Bob']));
    expect(suggest(`${doc}  A-‸`)!.labels).toEqual(expect.arrayContaining(['->>', '-->>', '-x', '-)']));
    const after = suggest(`${doc}  A->>‸`)!;
    expect(after.labels).toEqual(['A', 'Bob']);
    expect(after.apply('Bob')).toBe('Bob: ');
    expect(suggest(`${doc}  A->>Bob: he‸`)).toBeUndefined();
  });

  it('outros tipos: as palavras-chave de cada um', () => {
    expect(suggest('erDiagram\n  ORDER ‸', true)!.labels).toContain('||--o{');
    expect(suggest('gantt\n  sec‸')!.labels).toContain('section');
    expect(suggest('stateDiagram-v2\n  [‸')!.labels).toContain('[*] -->');
  });

  it('cada sugestão tem a descrição em inglês e em português', () => {
    for (const messages of [en, ptBR]) {
      const text = editorTextFrom(lookup(messages)).diagram.complete;
      const keys = new Set<string>();
      const all = [suggest('flowchart LR\n  A[‸')!, suggest('flowchart LR\n  A -‸')!, suggest('flowchart LR\n  ‸', true)!];
      for (const r of all) for (const d of r.details) if (d) keys.add(d);
      expect([...keys].filter(d => d.startsWith('?'))).toEqual([]);
      expect(text.types.every(t => t.header && !t.label.startsWith('?'))).toBe(true);
      expect(Object.keys(messages).filter(k => k.startsWith('editorText.mc.')).length).toBe(
        Object.keys(en).filter(k => k.startsWith('editorText.mc.')).length,
      );
    }
  });
});

describe('textos do autocompletar', () => {
  it('toda chave usada no módulo tem o texto em inglês e em português', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(new URL('./mermaidComplete.ts', import.meta.url), 'utf8');
    const keys = new Set([...code.matchAll(/s\('(?:[^'\\]|\\.)*',\s*'(?:[^'\\]|\\.)*',\s*'(\w+)'/g)].map(m => m[1]));
    keys.add('flowchart');
    expect(keys.size).toBeGreaterThan(80);
    for (const messages of [en, ptBR]) expect([...keys].filter(k => !messages[`editorText.mc.${k}`])).toEqual([]);
  });
});

describe('setas digitadas até o fim', () => {
  it('a lista continua aberta com "-->" e "==>" inteiros', () => {
    expect(suggest('flowchart LR\n  B -->‸')!.labels).toContain('-->');
    expect(suggest('flowchart LR\n  B ==>‸')!.labels).toContain('==>');
    expect(suggest('flowchart LR\n  B --o‸')!.labels).toContain('--o');
  });
});
