import * as vscode from 'vscode';

const PROPOSED_SCHEME = 'techdocs-proposed';

export type ProposalDecision = 'apply' | 'skip' | 'stop';

/**
 * Textos da pergunta: o título e, se não for uma correção da conferência, o que pular e parar querem dizer
 * (`skip: false`: uma mudança só, sem "Pular").
 */
export type ProposalLabels = { title: string; skip?: string | false; stop?: string };

/**
 * Mudança proposta num arquivo (spec 04, T3b): o diff do texto atual com o proposto (`techdocs-proposed:`) e a
 * pergunta aplicar, pular ou parar. Nada é gravado aqui: quem pergunta grava.
 */
export class ProposedChanges implements vscode.Disposable {
  /** Texto proposto de cada diff aberto. */
  private readonly proposed = new Map<string, string>();
  private readonly registration = vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, {
    provideTextDocumentContent: uri => this.proposed.get(uri.toString()) ?? '',
  });

  dispose() {
    this.registration.dispose();
  }

  /** `current` undefined: o arquivo ainda não existe (o diff compara com um arquivo vazio). */
  async ask(uri: vscode.Uri, current: string | undefined, next: string, labels: ProposalLabels): Promise<ProposalDecision> {
    const right = vscode.Uri.from({ scheme: PROPOSED_SCHEME, path: uri.path, query: String(Date.now()) });
    const left = current === undefined ? right.with({ query: `${right.query}-empty` }) : uri;
    this.proposed.set(right.toString(), next);
    if (current === undefined) this.proposed.set(left.toString(), '');
    const file = vscode.workspace.asRelativePath(uri);
    await vscode.commands.executeCommand('vscode.diff', left, right, vscode.l10n.t('{0} (proposed fix)', file), { preview: true });
    // Lista em vez de diálogo: fica aberta enquanto a pessoa rola o diff
    type Item = vscode.QuickPickItem & { value: ProposalDecision };
    const items: Item[] = [
      {
        label: vscode.l10n.t('Apply'),
        description: current === undefined ? vscode.l10n.t('creates {0}', file) : vscode.l10n.t('changes {0}, as in the diff', file),
        value: 'apply',
      },
      ...(labels.skip === false
        ? []
        : [{ label: vscode.l10n.t('Skip'), description: labels.skip ?? vscode.l10n.t('go to the next fix'), value: 'skip' as const }]),
      { label: vscode.l10n.t('Stop'), description: labels.stop ?? vscode.l10n.t('leave the other fixes for later'), value: 'stop' },
    ];
    const picked = await vscode.window.showQuickPick(items, { title: labels.title, ignoreFocusOut: true });
    await this.closeDiff(right);
    this.proposed.delete(right.toString());
    this.proposed.delete(left.toString());
    return picked?.value ?? 'stop';
  }

  private async closeDiff(right: vscode.Uri) {
    const tabs = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === right.toString());
    if (tabs.length) await vscode.window.tabGroups.close(tabs);
  }
}
