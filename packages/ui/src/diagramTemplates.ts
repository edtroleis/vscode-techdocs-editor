import {
  CHART_ICON,
  DIAGRAM_ICON,
  ENTITIES_ICON,
  GANTT_ICON,
  IDEA_ICON,
  SEQUENCE_ICON,
  STATE_ICON,
  STRUCTURE_ICON,
} from './icons';

/**
 * Os modelos de diagrama do menu "/" e da galeria (spec 06, M11 e M21–M24): grupo, ícone e, nos tipos novos do
 * Mermaid, a versão mínima que o TechDocs precisa para desenhar (`since`). O nome e o exemplo de cada um vêm das
 * mensagens: `editorText.diagram<Name>` e `editorText.diagramSample<Name>` (o fluxograma usa `diagramSample`).
 */

export type DiagramGroup = 'flows' | 'structure' | 'planning' | 'charts' | 'ideas';

export const DIAGRAM_GROUPS: readonly DiagramGroup[] = ['flows', 'structure', 'planning', 'charts', 'ideas'];

export type DiagramTemplateSpec = { key: string; name: string; group: DiagramGroup; icon: string; since?: string };

export const DIAGRAM_TEMPLATES: readonly DiagramTemplateSpec[] = [
  { key: 'flow', name: 'Flow', group: 'flows', icon: DIAGRAM_ICON },
  { key: 'sequence', name: 'Sequence', group: 'flows', icon: SEQUENCE_ICON },
  { key: 'state', name: 'State', group: 'flows', icon: STATE_ICON },
  { key: 'journey', name: 'Journey', group: 'flows', icon: DIAGRAM_ICON },
  { key: 'swimlane', name: 'Swimlane', group: 'flows', icon: DIAGRAM_ICON, since: '11.16' },
  { key: 'eventmodeling', name: 'EventModeling', group: 'flows', icon: DIAGRAM_ICON, since: '11.15' },
  { key: 'class', name: 'Class', group: 'structure', icon: STRUCTURE_ICON },
  { key: 'entities', name: 'Entities', group: 'structure', icon: ENTITIES_ICON },
  { key: 'architecture', name: 'Architecture', group: 'structure', icon: STRUCTURE_ICON },
  { key: 'block', name: 'Block', group: 'structure', icon: STRUCTURE_ICON },
  { key: 'c4', name: 'C4', group: 'structure', icon: STRUCTURE_ICON },
  { key: 'packet', name: 'Packet', group: 'structure', icon: STRUCTURE_ICON },
  { key: 'requirement', name: 'Requirement', group: 'structure', icon: STRUCTURE_ICON },
  { key: 'tree', name: 'Tree', group: 'structure', icon: STRUCTURE_ICON, since: '11.14' },
  { key: 'gantt', name: 'Gantt', group: 'planning', icon: GANTT_ICON },
  { key: 'timeline', name: 'Timeline', group: 'planning', icon: GANTT_ICON },
  { key: 'kanban', name: 'Kanban', group: 'planning', icon: GANTT_ICON },
  { key: 'git', name: 'Git', group: 'planning', icon: GANTT_ICON },
  { key: 'pie', name: 'Pie', group: 'charts', icon: CHART_ICON },
  { key: 'xy', name: 'Xy', group: 'charts', icon: CHART_ICON },
  { key: 'quadrant', name: 'Quadrant', group: 'charts', icon: CHART_ICON },
  { key: 'radar', name: 'Radar', group: 'charts', icon: CHART_ICON },
  { key: 'sankey', name: 'Sankey', group: 'charts', icon: CHART_ICON },
  { key: 'treemap', name: 'Treemap', group: 'charts', icon: CHART_ICON, since: '11.10' },
  { key: 'mindmap', name: 'Mindmap', group: 'ideas', icon: IDEA_ICON },
  { key: 'ishikawa', name: 'Ishikawa', group: 'ideas', icon: IDEA_ICON, since: '11.13' },
  { key: 'venn', name: 'Venn', group: 'ideas', icon: IDEA_ICON, since: '11.13' },
  { key: 'wardley', name: 'Wardley', group: 'ideas', icon: IDEA_ICON, since: '11.14' },
  { key: 'cynefin', name: 'Cynefin', group: 'ideas', icon: IDEA_ICON, since: '11.16' },
];

/**
 * Versão mínima do Mermaid de cada tipo novo, pela palavra que abre o diagrama. O MkDocs Material carrega o
 * Mermaid 11 mais novo; o addon de Mermaid do Backstage, o que estiver instalado (pede ^11.6). Os do 12 não
 * aparecem em nenhum dos dois por enquanto.
 */
const SINCE: Record<string, string> = {
  treemap: '11.10',
  ishikawa: '11.13',
  venn: '11.13',
  treeview: '11.14',
  wardley: '11.14',
  eventmodeling: '11.15',
  swimlane: '11.16',
  cynefin: '11.16',
  railroad: '11.16',
  usecase: '12',
  agentflow: '12',
};

/** A palavra que abre o diagrama (sem o front matter, os comentários e o "-beta"), em minúsculas. */
export function diagramKind(code: string): string {
  const body = code.replace(/^\s*---\r?\n[\s\S]*?\r?\n---[^\n]*\n/, '');
  for (const line of body.split('\n')) {
    const text = line.trim();
    if (!text || text.startsWith('%%')) continue;
    return (/^[A-Za-z0-9]+/.exec(text)?.[0] ?? '').toLowerCase();
  }
  return '';
}

/** Versão mínima do Mermaid que o TechDocs precisa para desenhar `code`, se for um tipo novo. */
export const diagramSince = (code: string): string | undefined => SINCE[diagramKind(code)];
