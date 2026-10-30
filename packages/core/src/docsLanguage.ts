import { parseDocument } from 'yaml';
import type { TemplateLanguage } from './builtInTemplates';

// Palavras curtas que só uma das duas línguas usa ("a", "as", "do", "no" e "se" ficam de fora: servem às duas)
const PT = new Set(['de', 'que', 'não', 'para', 'com', 'uma', 'um', 'os', 'da', 'das', 'dos', 'em', 'na', 'é', 'por', 'mais', 'como', 'ao', 'você', 'são', 'está', 'também', 'e', 'o', 'pelo', 'pela', 'este', 'esta', 'isso', 'só', 'sem', 'seu', 'sua', 'mas', 'foi', 'tem', 'quando', 'onde', 'aqui']);
const EN = new Set(['the', 'and', 'of', 'to', 'is', 'for', 'with', 'in', 'on', 'this', 'that', 'you', 'are', 'it', 'be', 'by', 'from', 'an', 'or', 'your', 'how']);
/** Menos palavras conhecidas que isso não decide nada (uma página só com título, por exemplo). */
const MIN_WORDS = 5;
/** Til e cedilha só aparecem no português ("serviço", "documentação"): cada palavra com eles conta como português. */
const PT_LETTERS = /[ãõç]/;

/** Língua de um texto em Markdown pelas palavras mais comuns, ou undefined se não dá para dizer. */
export function textLanguage(markdown: string): TemplateLanguage | undefined {
  const prose = markdown
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .toLowerCase();
  let pt = 0;
  let en = 0;
  for (const word of prose.match(/[\p{L}]+/gu) ?? []) {
    if (PT.has(word) || PT_LETTERS.test(word)) pt++;
    else if (EN.has(word)) en++;
  }
  if (pt + en < MIN_WORDS) return undefined;
  if (pt >= 2 * en) return 'pt-br';
  if (en >= 2 * pt) return 'en';
  return undefined;
}

/**
 * Língua dos templates para um site: a do tema no `mkdocs.yml` (`theme.language`), senão a do texto que já existe
 * (README, páginas), senão a do VS Code. Assim um site em português ganha páginas em português num VS Code em inglês.
 */
export function docsLanguage(mkdocs: string | undefined, texts: string[], fallback: TemplateLanguage): TemplateLanguage {
  const theme = mkdocsThemeLanguage(mkdocs);
  if (theme) return theme;
  const found = textLanguage(texts.join('\n\n'));
  return found ?? fallback;
}

function mkdocsThemeLanguage(mkdocs: string | undefined): TemplateLanguage | undefined {
  if (!mkdocs) return undefined;
  try {
    const language = (parseDocument(mkdocs).toJS() as { theme?: { language?: unknown } } | null)?.theme?.language;
    if (typeof language !== 'string') return undefined;
    if (language.toLowerCase().startsWith('pt')) return 'pt-br';
    if (language.toLowerCase().startsWith('en')) return 'en';
  } catch {
    // mkdocs.yml com tags do Python (!!python/name) ou quebrado: fica pelo texto
  }
  return undefined;
}
