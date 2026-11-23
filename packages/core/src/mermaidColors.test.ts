import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mermaidTooBig, addMermaidColors, addMermaidConfig, hasMermaidColors, hasMermaidFence, MERMAID_COLORS_FILE, MERMAID_SCRIPT_URL } from './mermaidConfig';

describe('cores do Mermaid no site (M25)', () => {
  it('o site carrega o mesmo Mermaid do editor', () => {
    const ui = JSON.parse(readFileSync(new URL('../../ui/package.json', import.meta.url), 'utf8'));
    expect(MERMAID_SCRIPT_URL).toContain(`mermaid@${ui.dependencies.mermaid}/`);
  });

  it('sem extra_javascript: a chave no fim, o Mermaid antes do script', () => {
    const out = addMermaidColors('site_name: X\n');
    expect(out).toBe(`site_name: X\nextra_javascript:\n  - ${MERMAID_SCRIPT_URL}\n  - ${MERMAID_COLORS_FILE}\n`);
    expect(hasMermaidColors(out)).toBe(true);
    expect(addMermaidColors(out)).toBe(out);
  });

  it('lista que já existe: no fim dela, com o mesmo recuo, sem mexer no resto', () => {
    const yml = 'site_name: X\nextra_javascript:\n    - js/a.js # meu\nnav:\n  - index.md\n';
    expect(addMermaidColors(yml)).toBe(
      `site_name: X\nextra_javascript:\n    - js/a.js # meu\n    - ${MERMAID_SCRIPT_URL}\n    - ${MERMAID_COLORS_FILE}\nnav:\n  - index.md\n`,
    );
  });

  it('o site já carrega um Mermaid: só o script das cores', () => {
    const yml = 'extra_javascript:\n  - https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js\n';
    expect(addMermaidColors(yml)).toBe(`${yml}  - ${MERMAID_COLORS_FILE}\n`);
  });

  it('lista numa linha', () => {
    const out = addMermaidColors('extra_javascript: [js/a.js]\n');
    expect(out).toBe(`extra_javascript:\n  - js/a.js\n  - ${MERMAID_SCRIPT_URL}\n  - ${MERMAID_COLORS_FILE}\n`);
  });

  it('addMermaidConfig: o bloco do superfences e as cores', () => {
    const out = addMermaidConfig('site_name: X\n');
    expect(hasMermaidFence(out)).toBe(true);
    expect(hasMermaidColors(out)).toBe(true);
  });
});

describe('mermaidTooBig (M27)', () => {
  const chain = (n: number) => `flowchart LR\n${Array.from({ length: n }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')}`;
  it('fluxograma com mais de 500 ligações, ou mais de 50 mil caracteres', () => {
    expect(mermaidTooBig(chain(500))).toBe(false);
    expect(mermaidTooBig(chain(501))).toBe(true);
    expect(mermaidTooBig(`sequenceDiagram\n${'  A->>B: oi\n'.repeat(600)}`)).toBe(false);
    expect(mermaidTooBig(`pie\n${'  "x" : 1\n'.repeat(6000)}`)).toBe(true);
  });
});
