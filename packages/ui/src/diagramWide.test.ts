import { describe, expect, it } from 'vitest';
import { sidewaysFlowchart, TECHDOCS_WIDTH, techdocsScale, turnTopDown } from './mermaidPreview';

describe('diagrama largo para o TechDocs (M32)', () => {
  it('escala no TechDocs: 1 se cabe, a largura da página sobre a natural se não', () => {
    expect(techdocsScale(500)).toBe(1);
    expect(techdocsScale(TECHDOCS_WIDTH * 2)).toBe(0.5);
  });

  it('fluxograma de lado: LR e RL, com front matter e comentários antes', () => {
    expect(sidewaysFlowchart('flowchart LR\n  A-->B')).toBe(true);
    expect(sidewaysFlowchart('graph RL\n  A-->B')).toBe(true);
    expect(sidewaysFlowchart('---\ntitle: X\n---\n%% c\nflowchart LR\n  A-->B')).toBe(true);
    expect(sidewaysFlowchart('flowchart TD\n  A-->B')).toBe(false);
    expect(sidewaysFlowchart('sequenceDiagram\n  A->>B: oi')).toBe(false);
    // "direction LR" num subgrafo não é a direção do diagrama
    expect(sidewaysFlowchart('flowchart TB\n  subgraph s\n    direction LR\n  end')).toBe(false);
  });

  it('vira só a direção da primeira linha', () => {
    expect(turnTopDown('flowchart LR\n  subgraph s\n    direction LR\n  end')).toBe('flowchart TD\n  subgraph s\n    direction LR\n  end');
    expect(turnTopDown('---\ntitle: X\n---\ngraph RL\n  A-->B')).toBe('---\ntitle: X\n---\ngraph TD\n  A-->B');
    expect(turnTopDown('flowchart TD\n  A-->B')).toBe('flowchart TD\n  A-->B');
  });
});
