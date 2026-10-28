import * as vscode from 'vscode';
import type { SiteFinding, SiteFindingCode } from '@edtroleis/techdocs-editor-core';
import { CHECK_VIEW, findingMessage, RepoCheck, SiteCheck } from './repoCheck';

/** Item da seção Verificação: um site (com mais de um), um tipo de achado ou um achado. */
export class CheckItem {
  readonly children: CheckItem[] = [];
  constructor(
    readonly kind: 'site' | 'group' | 'finding' | 'ok',
    readonly label: string,
    readonly finding?: SiteFinding,
    readonly base?: vscode.Uri,
    readonly description?: string,
  ) {}
}

/** Ordem dos grupos: o que impede o site de montar primeiro. */
const CODE_ORDER: SiteFindingCode[] = [
  'site-name-missing',
  'techdocs-plugin-missing',
  'docs-dir-missing',
  'nav-page-missing',
  'broken-link',
  'missing-image',
  'index-missing',
  'page-not-in-nav',
  'catalog-ref-missing',
  'lint-problems',
  'catalog-missing',
  'lint-config-missing',
];

/**
 * Seção "Verificação" da barra lateral TechDocs (spec 04, T3b): os achados da conferência agrupados por tipo,
 * cada um levando ao arquivo e à linha, com o botão de corrigir quando há correção. Confere sozinha na primeira
 * vez em que aparece.
 */
export class CheckView implements vscode.TreeDataProvider<CheckItem>, vscode.Disposable {
  private roots: CheckItem[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly view: vscode.TreeView<CheckItem>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly repoCheck: RepoCheck) {
    this.view = vscode.window.createTreeView(CHECK_VIEW, { treeDataProvider: this, showCollapseAll: true });
    this.disposables.push(
      this.view,
      this.changeEmitter,
      repoCheck.onDidCheck(results => this.update(results)),
      this.view.onDidChangeVisibility(({ visible }) => {
        if (visible && !repoCheck.last) void repoCheck.check(true);
      }),
      vscode.commands.registerCommand('techdocsEditor.fixFinding', (item?: CheckItem) =>
        item?.finding && item.base ? repoCheck.fixOne(item.finding, item.base) : undefined,
      ),
    );
    if (repoCheck.last) this.update(repoCheck.last);
  }

  getTreeItem(item: CheckItem): vscode.TreeItem {
    const tree = new vscode.TreeItem(
      item.label,
      item.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    tree.description = item.description;
    switch (item.kind) {
      case 'site':
        tree.iconPath = new vscode.ThemeIcon('book');
        break;
      case 'ok':
        tree.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        break;
      case 'group':
        tree.iconPath = severityIcon(item.children[0]?.finding?.severity ?? 'info');
        break;
      case 'finding': {
        const finding = item.finding!;
        const uri = vscode.Uri.joinPath(item.base!, finding.file);
        tree.tooltip = findingMessage(finding);
        // Sem catalog-info.yaml no modo auto: "Configurar…" abre as opções da verificação
        tree.contextValue = finding.fix ? 'fixable' : finding.code === 'catalog-missing' ? 'catalogHint' : 'finding';
        const line = Math.max(0, (finding.line ?? 1) - 1);
        tree.command = {
          command: 'vscode.open',
          title: vscode.l10n.t('Open'),
          arguments: [uri, { selection: new vscode.Range(line, 0, line, 0) }],
        };
        break;
      }
    }
    return tree;
  }

  getChildren(item?: CheckItem): CheckItem[] {
    return item ? item.children : this.roots;
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  private update(results: SiteCheck[]) {
    const single = results.length === 1;
    this.roots = results.flatMap(result => {
      const groups = groupItems(result);
      if (single) return groups.length ? groups : [okItem()];
      const site = new CheckItem('site', vscode.workspace.asRelativePath(result.mkdocs), undefined, undefined, findingsCount(toReview(result.findings)));
      site.children.push(...(groups.length ? groups : [okItem()]));
      return [site];
    });
    // Dicas (ex.: sem catalog-info.yaml no modo auto) aparecem, mas não contam como itens a revisar
    const total = results.reduce((sum, r) => sum + toReview(r.findings), 0);
    this.view.badge = total ? { value: total, tooltip: vscode.l10n.t('Items to review in the documentation: {0}', total) } : undefined;
    this.changeEmitter.fire();
  }
}

function groupItems({ base, findings }: SiteCheck): CheckItem[] {
  const groups: CheckItem[] = [];
  for (const code of CODE_ORDER) {
    const list = findings.filter(f => f.code === code);
    if (!list.length) continue;
    const group = new CheckItem('group', groupTitle(code), undefined, undefined, String(list.length));
    group.children.push(
      ...list.map(finding => {
        const where = `${finding.file}${finding.line ? `:${finding.line}` : ''}`;
        const label = finding.code === 'lint-problems' ? finding.file : (finding.target ?? finding.file);
        const detail = finding.code === 'lint-problems' ? findingsCount(Number(finding.target)) : label === finding.file ? undefined : where;
        return new CheckItem('finding', label, finding, base, detail);
      }),
    );
    groups.push(group);
  }
  return groups;
}

const okItem = () => new CheckItem('ok', vscode.l10n.t('Nothing missing or wrong'));

const toReview = (findings: SiteFinding[]) => findings.filter(f => f.severity !== 'hint').length;

const findingsCount = (count: number) => (count === 1 ? vscode.l10n.t('1 item') : vscode.l10n.t('{0} items', count));

function severityIcon(severity: SiteFinding['severity']) {
  return severity === 'error'
    ? new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'))
    : severity === 'warning'
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
      : severity === 'hint'
        ? new vscode.ThemeIcon('lightbulb')
        : new vscode.ThemeIcon('info');
}

/** Título curto de cada tipo de achado (o texto completo fica na dica de cada item). */
function groupTitle(code: SiteFindingCode): string {
  switch (code) {
    case 'site-name-missing':
      return vscode.l10n.t('site_name missing in mkdocs.yml');
    case 'techdocs-plugin-missing':
      return vscode.l10n.t('techdocs-core plugin missing');
    case 'docs-dir-missing':
      return vscode.l10n.t('Docs folder missing');
    case 'nav-page-missing':
      return vscode.l10n.t('Nav points to missing pages');
    case 'broken-link':
      return vscode.l10n.t('Broken links');
    case 'missing-image':
      return vscode.l10n.t('Missing images');
    case 'index-missing':
      return vscode.l10n.t('Home page missing');
    case 'page-not-in-nav':
      return vscode.l10n.t('Pages not in the nav');
    case 'catalog-ref-missing':
      return vscode.l10n.t('TechDocs annotation missing in catalog-info.yaml');
    case 'lint-problems':
      return vscode.l10n.t('Pages with formatting problems');
    case 'catalog-missing':
      return vscode.l10n.t('No catalog-info.yaml');
    case 'lint-config-missing':
      return vscode.l10n.t('No markdownlint configuration');
  }
}
