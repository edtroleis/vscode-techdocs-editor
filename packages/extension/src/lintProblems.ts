import type { Configuration } from 'markdownlint';
import { fixLintProblems, lintMarkdown, lintRuleText } from '@edtroleis/techdocs-editor-core';

/** Problema de formatação de uma página, já com o texto em linguagem simples. */
export type PageProblem = {
  /** Linha no arquivo, a partir de 1. */
  line: number;
  /** Regra do markdownlint (ex.: MD040). */
  rule: string;
  message: string;
  /** "Ajustar agora" resolve este problema. */
  fixable: boolean;
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Problemas de `text` (no formato do repositório, com `\n`) pela configuração da pipeline (spec 01,
 * L-1), com o texto da regra na língua da pessoa (L-3).
 */
export function pageProblems(text: string, config: Configuration, language: string): PageProblem[] {
  return lintMarkdown(text, config).map(p => ({
    line: p.line,
    rule: p.rule,
    message: capitalize(lintRuleText(p.rule, language, p.description)),
    fixable: p.fixable,
  }));
}

/** Texto com as correções automáticas (L-4), ou undefined se não há o que corrigir. */
export function fixedText(text: string, config: Configuration): string | undefined {
  const fixed = fixLintProblems(text, config);
  return fixed === text ? undefined : fixed;
}

/**
 * Pastas onde procurar o `.markdownlint.*`, da mais próxima para a mais distante: a do `mkdocs.yml` e
 * as de cima, até a raiz do workspace (a raiz do repositório, onde a pipeline o lê).
 */
export function configDirs(siteRoot: string, workspaceRoot: string): string[] {
  const top = workspaceRoot.replace(/\/+$/, '');
  if (siteRoot !== top && !siteRoot.startsWith(`${top}/`)) return [siteRoot];
  const dirs: string[] = [];
  for (let dir = siteRoot; ; dir = dir.replace(/\/[^/]*$/, '')) {
    dirs.push(dir);
    if (dir === top || !dir.includes('/')) break;
  }
  return dirs;
}
