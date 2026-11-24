import * as vscode from 'vscode';

/**
 * Os moldes do resumo do envio (`sendSummary` do `core`, em inglês) traduzidos pelo VS Code. Um a um e literais: é
 * assim que o teste de l10n acha os textos.
 */
export function summaryText(message: string, ...args: Array<string | number>): string {
  switch (message) {
    case 'updates {0}':
      return vscode.l10n.t('updates {0}', ...args);
    case 'creates {0}':
      return vscode.l10n.t('creates {0}', ...args);
    case 'removes {0}':
      return vscode.l10n.t('removes {0}', ...args);
    case 'moves {0}':
      return vscode.l10n.t('moves {0}', ...args);
    case 'updates the menu':
      return vscode.l10n.t('updates the menu');
    case 'adds images':
      return vscode.l10n.t('adds images');
    case '{0} and {1}':
      return vscode.l10n.t('{0} and {1}', ...args);
    default:
      return message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
  }
}
