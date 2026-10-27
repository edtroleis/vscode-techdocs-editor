import * as vscode from 'vscode';
import { DIAGNOSTIC_SOURCE, LintService } from './lintService';

export const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append('techdocs');

/**
 * "Ajustar agora" no editor de texto (spec 01, L-4): a lâmpada nos problemas da página e o
 * `source.fixAll.techdocs` (para quem quiser em `editor.codeActionsOnSave`). Aplica todas as correções
 * automáticas de uma vez, como o botão do editor visual.
 */
export class LintActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix, FIX_ALL_KIND];

  constructor(private readonly lint: LintService) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    const wantsFixAll = context.only?.contains(FIX_ALL_KIND) || context.only?.intersects(FIX_ALL_KIND);
    // Só os problemas que a correção resolve: num problema sem correção, a lâmpada mexeria em outro lugar.
    // Os diagnostics vêm da página, não do `context` (que chega vazio por `vscode.executeCodeActionProvider`)
    const fixable = this.lint.problems(document.uri).filter(p => p.fixable);
    const ours = vscode.languages
      .getDiagnostics(document.uri)
      .filter(
        d =>
          d.source === DIAGNOSTIC_SOURCE &&
          d.range.intersection(range) !== undefined &&
          fixable.some(p => p.line === d.range.start.line + 1 && p.rule === ruleOf(d)),
      );
    if (!wantsFixAll && ours.length === 0) return [];
    const edit = await this.lint.fixEdit(document);
    if (!edit) return [];
    const title = vscode.l10n.t('Fix formatting automatically');
    if (wantsFixAll) {
      const action = new vscode.CodeAction(title, FIX_ALL_KIND);
      action.edit = edit;
      return [action];
    }
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.diagnostics = ours;
    action.isPreferred = true;
    return [action];
  }
}

const ruleOf = (diagnostic: vscode.Diagnostic) =>
  typeof diagnostic.code === 'object' ? String(diagnostic.code.value) : String(diagnostic.code);
