import { addMermaidFence, hasMermaidFence, mermaidBlocks } from './mermaidConfig';

const FENCE = `  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
`;

describe('mermaidBlocks', () => {
  it('acha o bloco com a linha do código', () => {
    expect(mermaidBlocks('# T\n\n```mermaid\nflowchart LR\n  A-->B\n```\n')).toEqual([{ line: 4, code: 'flowchart LR\n  A-->B' }]);
  });

  it('aceita tis e ignora outras linguagens', () => {
    expect(mermaidBlocks('~~~mermaid\nA\n~~~\n\n```js\nx\n```\n')).toEqual([{ line: 2, code: 'A' }]);
  });

  it('ignora o mermaid dentro de outra cerca', () => {
    expect(mermaidBlocks('````md\n```mermaid\nA\n```\n````\n')).toEqual([]);
  });

  it('arquivo com CRLF', () => {
    expect(mermaidBlocks('# T\r\n\r\n```mermaid\r\nflowchart LR\r\n  A-->B\r\n```\r\n')).toEqual([{ line: 4, code: 'flowchart LR\n  A-->B' }]);
  });

  it('bloco vazio', () => {
    expect(mermaidBlocks('```mermaid\n```\n')).toEqual([{ line: 2, code: '' }]);
  });
});

describe('addMermaidFence', () => {
  it('sem markdown_extensions: acrescenta a configuração da spec', () => {
    const yml = addMermaidFence('site_name: X\n');
    expect(yml).toBe(`site_name: X\nmarkdown_extensions:\n${FENCE}`);
    expect(hasMermaidFence(yml)).toBe(true);
  });

  it('mantém as outras extensões', () => {
    const yml = addMermaidFence('site_name: X\nmarkdown_extensions:\n  - admonition\n');
    expect(yml).toBe(`site_name: X\nmarkdown_extensions:\n  - admonition\n${FENCE}`);
  });

  it('junta com outro custom_fences, mantendo a tag', () => {
    const before = `site_name: X
markdown_extensions:
  - pymdownx.superfences:
      custom_fences:
        - name: math
          class: arithmatex
          format: !!python/name:pymdownx.arithmatex.fence_mathjax_format
`;
    const yml = addMermaidFence(before);
    expect(yml).toContain('format: !!python/name:pymdownx.arithmatex.fence_mathjax_format');
    expect(yml).toContain('- name: math');
    expect(hasMermaidFence(yml)).toBe(true);
    expect(yml.match(/- pymdownx\.superfences/g)).toHaveLength(1);
  });

  it('superfences sem opções vira mapa com o custom_fences', () => {
    const yml = addMermaidFence('markdown_extensions:\n  - pymdownx.superfences\n  - admonition\n');
    expect(hasMermaidFence(yml)).toBe(true);
    expect(yml).toContain('- admonition');
    expect(yml.match(/- pymdownx\.superfences/g)).toHaveLength(1);
  });

  it('mantém tags e comentários de outras chaves', () => {
    const before = `site_name: X # nome
theme:
  name: material
markdown_extensions:
  - pymdownx.emoji:
      emoji_index: !!python/name:material.extensions.emoji.twemoji
`;
    const yml = addMermaidFence(before);
    expect(yml.startsWith(before)).toBe(true);
    expect(hasMermaidFence(yml)).toBe(true);
  });

  it('lista numa linha vira lista em bloco', () => {
    expect(addMermaidFence('site_name: X\nmarkdown_extensions: [admonition, toc]\n')).toBe(
      `site_name: X\nmarkdown_extensions:\n  - admonition\n  - toc\n${FENCE}`,
    );
  });

  it('aplicar de novo não muda nada', () => {
    for (const y of ['site_name: X\n', 'markdown_extensions:\n  - pymdownx.superfences\n']) {
      const once = addMermaidFence(y);
      expect(addMermaidFence(once)).toBe(once);
    }
  });

  it('hasMermaidFence: falso sem a cerca e com outro nome', () => {
    expect(hasMermaidFence('site_name: X\n')).toBe(false);
    expect(hasMermaidFence(`markdown_extensions:\n${FENCE.replace('name: mermaid', 'name: math')}`)).toBe(false);
  });
});
