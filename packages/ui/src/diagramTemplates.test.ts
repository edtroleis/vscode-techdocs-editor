import { describe, expect, it } from 'vitest';
import { DIAGRAM_TEMPLATES, diagramKind, diagramSince } from './diagramTemplates';
import { en } from './messages/en';
import { ptBR } from './messages/pt-BR';

describe('diagramKind', () => {
  it('a palavra que abre o diagrama, sem -beta, front matter nem comentários', () => {
    expect(diagramKind('venn-beta\n  set A')).toBe('venn');
    expect(diagramKind('---\ntitle: X\n---\n%% nota\n\ntreeView-beta\n  a/')).toBe('treeview');
    expect(diagramKind('  flowchart LR\n  A-->B')).toBe('flowchart');
    expect(diagramKind('')).toBe('');
  });
});

describe('diagramSince', () => {
  it('versão mínima dos tipos novos; nada nos de sempre', () => {
    expect(diagramSince('cynefin-beta\n  complex')).toBe('11.16');
    expect(diagramSince('usecase-beta\n  actor A')).toBe('12');
    expect(diagramSince('pie title X')).toBeUndefined();
    expect(diagramSince('architecture-beta\n  service a')).toBeUndefined();
  });

  it('a etiqueta de cada modelo bate com o aviso do exemplo dele', () => {
    for (const messages of [en, ptBR] as Record<string, string>[])
      for (const t of DIAGRAM_TEMPLATES) {
        const sample = messages[t.key === 'flow' ? 'editorText.diagramSample' : `editorText.diagramSample${t.name}`];
        expect(sample, t.name).toBeTruthy();
        expect(diagramSince(sample), t.name).toBe(t.since);
      }
  });
});
