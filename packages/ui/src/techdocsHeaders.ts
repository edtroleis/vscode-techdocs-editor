/**
 * Os cabeçalhos dos componentes do MkDocs no editor (spec 01, M1): avisos `!!! tip "Título"`, recolhíveis
 * `??? tip "Título"` / `???+ tip "Título"` e abas `=== "Título"`. O cabeçalho escrito é a fonte da verdade (o
 * arquivo volta igual); estas funções só o leem para mostrar e o reescrevem quando a pessoa muda algo.
 */

export type Marker = '!!!' | '???' | '???+';

export type AdmonitionHeader = {
  marker: Marker;
  /** O tipo (`tip`, `warning`…), como está escrito. */
  kind: string;
  /** Classes a mais depois do tipo (` inline end`), como estão escritas. */
  extra: string;
  /** O título entre aspas; `null` sem título (o Material mostra o nome do tipo), `''` com `""` (sem cabeçalho). */
  title: string | null;
};

const ADMONITION = /^(!!!|\?\?\?\+?)\s+([\w-]+)((?:\s+[\w-]+)*)\s*(?:"(.*)")?\s*$/;

export function parseAdmonition(header: string): AdmonitionHeader | undefined {
  const m = ADMONITION.exec(header);
  if (!m) return undefined;
  return { marker: m[1] as Marker, kind: m[2], extra: m[3], title: m[4] ?? null };
}

export function formatAdmonition(h: AdmonitionHeader): string {
  return `${h.marker} ${h.kind}${h.extra}${h.title === null ? '' : ` "${h.title}"`}`;
}

export type TabHeader = { selected: boolean; title: string };

const TAB = /^(===\+?)\s+"(.*)"\s*$/;

export function parseTab(header: string): TabHeader | undefined {
  const m = TAB.exec(header);
  return m ? { selected: m[1] === '===+', title: m[2] } : undefined;
}

export function formatTab(h: TabHeader): string {
  return `${h.selected ? '===+' : '==='} "${h.title}"`;
}

/** Os tipos do Material for MkDocs, na ordem do menu, e os apelidos de cada um (mesma cor e ícone). */
export const ADMONITION_KINDS = [
  'note',
  'abstract',
  'info',
  'tip',
  'success',
  'question',
  'warning',
  'failure',
  'danger',
  'bug',
  'example',
  'quote',
] as const;
export type AdmonitionKind = (typeof ADMONITION_KINDS)[number];

const ALIASES: Record<string, AdmonitionKind> = {
  summary: 'abstract',
  tldr: 'abstract',
  todo: 'info',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};

/** O tipo do Material que dá a cor e o ícone (tipo desconhecido fica como nota, como no Material). */
export function kindStyle(kind: string): AdmonitionKind {
  const lower = kind.toLowerCase();
  return (ADMONITION_KINDS as readonly string[]).includes(lower) ? (lower as AdmonitionKind) : (ALIASES[lower] ?? 'note');
}
