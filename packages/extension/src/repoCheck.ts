import * as vscode from 'vscode';
import { checkSite, LINT_CONFIG_FILES, SiteFinding, SiteSnapshot } from '@edtroleis/techdocs-editor-core';
import { catalogModeFor } from './catalogOptions';
import type { DocsSite } from './docsSite';
import { configDirs } from './lintProblems';
import type { LintService } from './lintService';
import type { LocalSites } from './localSites';
import type { ProposedChanges } from './proposedChange';
import type { NewSiteCommand } from './templates/newSite';
import { exists, gitUserName, readText } from './templates/templateSources';

type Site = { mkdocs: vscode.Uri; site: DocsSite };

/** Achados de um site, com a raiz do repositório (os caminhos dos achados são relativos a ela). */
export type SiteCheck = { mkdocs: vscode.Uri; base: vscode.Uri; findings: SiteFinding[] };

/** Respostas prontas para "Preparar", nos testes: o site e quais correções aplicar (sem diff nem perguntas). */
export type PrepareAnswers = { site?: vscode.Uri; apply: (finding: SiteFinding) => boolean };

export const CHECK_VIEW = 'techdocsEditor.check';
/** Depois de salvar, espera um pouco antes de conferir de novo (salvar vários arquivos dá uma conferência só). */
const RECHECK_DELAY_MS = 800;

/**
 * "TechDocs: Conferir a documentação do repositório" e "TechDocs: Preparar a documentação neste repositório"
 * (spec 04, T3b). A lógica fica no `core` (`checkSite`); aqui, o retrato de cada site, o painel Problemas e as
 * correções, uma por uma, com o diff antes.
 */
export class RepoCheck implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('techdocs-check');
  private readonly checkedEmitter = new vscode.EventEmitter<SiteCheck[]>();
  /** Uma conferência terminou (a seção Verificação se redesenha). */
  readonly onDidCheck = this.checkedEmitter.event;
  /** Resultado da última conferência (undefined: ainda não conferiu nesta sessão). */
  last: SiteCheck[] | undefined;
  private recheckTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [this.diagnostics, this.checkedEmitter];

  constructor(
    private readonly sites: LocalSites,
    private readonly lint: LintService,
    private readonly newSite: NewSiteCommand,
    private readonly proposals: ProposedChanges,
  ) {
    this.disposables.push(
      // Depois de conferir uma vez, a conferência acompanha o que a pessoa salva
      vscode.workspace.onDidSaveTextDocument(() => {
        if (!this.last) return;
        clearTimeout(this.recheckTimer);
        this.recheckTimer = setTimeout(() => void this.check(true), RECHECK_DELAY_MS);
      }),
      // O modo do catalog-info.yaml mudou na configuração: o que a conferência mostra também muda
      vscode.workspace.onDidChangeConfiguration(event => {
        if (this.last && event.affectsConfiguration('techdocsEditor.catalog')) void this.check(true);
      }),
    );
  }

  dispose() {
    clearTimeout(this.recheckTimer);
    this.disposables.forEach(d => d.dispose());
  }

  /**
   * Confere todos os sites do workspace: os achados vão para a seção Verificação e para o painel Problemas.
   * Sem `quiet`, mostra a seção Verificação.
   */
  async check(quiet = false): Promise<SiteCheck[]> {
    await this.sites.ready;
    const sites = this.sites.list();
    if (!sites.length) {
      this.diagnostics.clear();
      if (!quiet) {
        const prepare = vscode.l10n.t('Prepare the documentation');
        const answer = await vscode.window.showWarningMessage(vscode.l10n.t('There is no mkdocs.yml in the workspace.'), prepare);
        if (answer === prepare) await this.prepare();
      }
      return [];
    }
    const results: SiteCheck[] = [];
    for (const site of sites) {
      const { snapshot, base } = await this.snapshot(site);
      results.push({ mkdocs: site.mkdocs, base, findings: checkSite(snapshot) });
    }
    this.show(results);
    this.last = results;
    this.checkedEmitter.fire(results);
    if (!quiet) {
      // Sem a Manutenção ligada a seção fica escondida: quem pediu a conferência vê o resultado mesmo assim
      await vscode.commands.executeCommand('setContext', 'techdocsEditor.checkAsked', true);
      void vscode.commands.executeCommand(`${CHECK_VIEW}.focus`);
    }
    return results;
  }

  /**
   * Sem `mkdocs.yml`: cria um site de template (T3). Com: as correções da conferência do site, uma por uma, com o
   * diff antes. O que não tem correção automática fica no painel Problemas.
   */
  async prepare(target?: vscode.Uri, answers?: PrepareAnswers): Promise<number> {
    await this.sites.ready;
    const site = await this.pickSite(answers?.site ?? target);
    if (site === null) return 0;
    if (!site) {
      await this.newSite.run(target);
      return 0;
    }
    const { snapshot, base } = await this.snapshot(site);
    const fixable = checkSite(snapshot).filter(f => f.fix);
    let applied = 0;
    for (const finding of fixable) {
      const decision = await this.applyFix(finding, base, answers ? () => (answers.apply(finding) ? 'apply' : 'skip') : undefined);
      if (decision === 'stop') break;
      if (decision === 'apply') applied++;
    }
    const results = await this.check(true);
    const left = results.find(r => r.mkdocs.toString() === site.mkdocs.toString())?.findings.length ?? 0;
    if (!answers) {
      void vscode.window.showInformationMessage(
        fixable.length
          ? vscode.l10n.t('Fixes applied: {0}. Still to review in the Check view: {1}.', applied, left)
          : vscode.l10n.t('Nothing to fix automatically. Still to review in the Check view: {0}.', left),
      );
    }
    return applied;
  }

  /** Um achado da seção Verificação: o diff da correção, a pergunta e a conferência de novo. */
  async fixOne(finding: SiteFinding, base: vscode.Uri): Promise<void> {
    if (!finding.fix) return;
    const decision = await this.applyFix(finding, base);
    if (decision === 'unchanged') void vscode.window.showInformationMessage(vscode.l10n.t('Already fixed: nothing to change.'));
    await this.check(true);
  }

  /**
   * Aplica a correção sobre o texto do momento, depois do diff e da pergunta (ou da resposta pronta dos testes).
   * `'unchanged'`: outra correção já resolveu (ex.: o index.md criado pela da pasta das docs).
   */
  private async applyFix(finding: SiteFinding, base: vscode.Uri, decide?: () => 'apply' | 'skip') {
    const fix = finding.fix!;
    return this.proposeChange(vscode.Uri.joinPath(base, fix.file), fix.apply, findingMessage(finding), decide);
  }

  /**
   * Mudança num arquivo com o diff antes e a pergunta `title` (ou a resposta pronta dos testes), também fora da
   * conferência (ex.: o `.techdocs-editor.yaml` das opções da verificação). `change` recebe o texto do momento.
   */
  async proposeChange(uri: vscode.Uri, change: (current: string | undefined) => string, title: string, decide?: () => 'apply' | 'skip') {
    const current = await this.currentText(uri);
    const next = change(current);
    if (next === current) return 'unchanged';
    const decision = decide ? decide() : await this.proposals.ask(uri, current, next, { title });
    if (decision === 'apply') await this.write(uri, current, next);
    return decision;
  }

  /** O site a preparar: o do arquivo ou pasta, o único, ou o escolhido; undefined sem nenhum, null se cancelou. */
  private async pickSite(target?: vscode.Uri): Promise<Site | undefined | null> {
    const sites = this.sites.list();
    if (!sites.length) return undefined;
    if (target) {
      const path = target.path;
      const inside = sites
        .filter(s => path === s.mkdocs.path || path === s.site.root || path.startsWith(`${s.site.root}/`))
        .sort((a, b) => b.site.root.length - a.site.root.length)[0];
      if (inside) return inside;
    }
    if (sites.length === 1) return sites[0];
    const newSite = { label: vscode.l10n.t('$(add) New documentation site…'), site: undefined };
    const picked = await vscode.window.showQuickPick(
      [...sites.map(s => ({ label: vscode.workspace.asRelativePath(s.mkdocs), site: s as Site | undefined })), newSite],
      { title: vscode.l10n.t('Which documentation site?') },
    );
    return picked ? picked.site : null;
  }

  /** Retrato do site para o `core`, com os caminhos relativos à pasta do workspace (a raiz do repositório). */
  private async snapshot(site: Site): Promise<{ snapshot: SiteSnapshot; base: vscode.Uri }> {
    const root = site.mkdocs.with({ path: site.site.root });
    const base = vscode.workspace.getWorkspaceFolder(site.mkdocs)?.uri ?? root;
    const rel = (uri: vscode.Uri) => (uri.path === base.path ? '' : uri.path.startsWith(`${base.path}/`) ? uri.path.slice(base.path.length + 1) : uri.path);
    const docsDir = site.mkdocs.with({ path: site.site.docsDir });
    const docsDirExists = (await vscode.workspace.fs.stat(docsDir).then(s => s.type, () => 0)) === vscode.FileType.Directory;
    const files = docsDirExists
      ? (await vscode.workspace.findFiles(new vscode.RelativePattern(docsDir, '**/*'))).map(uri => uri.path.slice(docsDir.path.length + 1)).sort()
      : [];
    const pages: Record<string, string> = {};
    for (const path of files.filter(f => /\.md$/i.test(f))) {
      const text = await this.currentText(vscode.Uri.joinPath(docsDir, path));
      if (text !== undefined) pages[path] = text;
    }
    let lintConfigFile: string | undefined;
    for (const dir of configDirs(root.path, base.path)) {
      for (const name of LINT_CONFIG_FILES) {
        if (!lintConfigFile && (await exists(root.with({ path: `${dir}/${name}` })))) lintConfigFile = rel(root.with({ path: `${dir}/${name}` }));
      }
    }
    let catalog: SiteSnapshot['catalog'];
    for (const dir of [root, base]) {
      const uri = vscode.Uri.joinPath(dir, 'catalog-info.yaml');
      const text = catalog ? undefined : await this.currentText(uri);
      if (text !== undefined) catalog = { file: rel(uri), text };
    }
    const { mode: catalogMode } = await catalogModeFor(base);
    // Sem catalog-info.yaml no site, o modo auto só dá a dica se outro repositório do workspace tem um. Limite acima de
    // 1: no navegador, o findFiles com maxResults 1 não acha nada
    const backstageSignal = catalog || catalogMode !== 'auto' ? undefined : (await vscode.workspace.findFiles('**/catalog-info.yaml', '**/node_modules/**', 5)).length > 0;
    // O dono só entra no catalog-info.yaml novo: o Git só é consultado quando ele pode ser criado
    const owner = catalogMode === 'required' && !catalog ? await gitUserName(base) : undefined;
    return {
      base,
      snapshot: {
        root: rel(root),
        mkdocsFile: rel(site.mkdocs),
        mkdocsYml: (await this.currentText(site.mkdocs)) ?? '',
        docsDir: rel(docsDir),
        docsDirExists,
        files,
        pages,
        lintConfigFile,
        // Sem confiar no workspace, a configuração do repositório não vale e o lint não é conferido (spec 02)
        lintConfig: await this.lint.configFor(vscode.Uri.joinPath(docsDir, 'index.md')),
        catalog,
        catalogMode,
        backstageSignal,
        repository: { name: decodeURIComponent(base.path.split('/').filter(Boolean).pop() ?? ''), owner },
      },
    };
  }

  /** Texto do arquivo como está no editor (com o que não foi salvo), ou do disco; undefined se não existe. */
  private async currentText(uri: vscode.Uri): Promise<string | undefined> {
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    return open ? open.getText() : readText(uri);
  }

  private async write(uri: vscode.Uri, current: string | undefined, next: string) {
    if (current === undefined) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(next));
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const wasDirty = document.isDirty;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), next);
    if ((await vscode.workspace.applyEdit(edit)) && !wasDirty) await document.save();
  }

  private show(results: SiteCheck[]) {
    this.diagnostics.clear();
    const byFile = new Map<string, { uri: vscode.Uri; list: vscode.Diagnostic[] }>();
    for (const { base, findings } of results) {
      for (const finding of findings) {
        const uri = vscode.Uri.joinPath(base, finding.file);
        const line = Math.max(0, (finding.line ?? 1) - 1);
        const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), findingMessage(finding), SEVERITY[finding.severity]);
        diagnostic.source = 'TechDocs';
        diagnostic.code = finding.code;
        const entry = byFile.get(uri.toString()) ?? { uri, list: [] };
        entry.list.push(diagnostic);
        byFile.set(uri.toString(), entry);
      }
    }
    for (const { uri, list } of byFile.values()) this.diagnostics.set(uri, list);
  }
}

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/** Texto do achado em linguagem simples. */
export function findingMessage(finding: SiteFinding): string {
  const target = finding.target ?? '';
  switch (finding.code) {
    case 'site-name-missing':
      return vscode.l10n.t('mkdocs.yml has no site_name: TechDocs needs it to build the site.');
    case 'techdocs-plugin-missing':
      return vscode.l10n.t('The techdocs-core plugin is missing from plugins in mkdocs.yml: TechDocs builds the site with it.');
    case 'docs-dir-missing':
      return vscode.l10n.t('The docs folder {0} does not exist.', target);
    case 'index-missing':
      return vscode.l10n.t('The site has no home page (index.md in the docs folder).');
    case 'nav-page-missing':
      return vscode.l10n.t('The nav points to a page that does not exist: {0}', target);
    case 'page-not-in-nav':
      return vscode.l10n.t('This page is not in the nav of mkdocs.yml, so it does not show in the site menu.');
    case 'catalog-missing':
      return vscode.l10n.t('There is no catalog-info.yaml in the site folder or in the repository root: the docs will not show in the Backstage catalog.');
    case 'catalog-ref-missing':
      return vscode.l10n.t('catalog-info.yaml has no TechDocs annotation. Add to metadata.annotations: {0}', target);
    case 'lint-config-missing':
      return vscode.l10n.t('There is no markdownlint configuration: the formatting check uses every rule. Suggested: {0}', target);
    case 'lint-problems':
      return vscode.l10n.t('Formatting problems on this page: {0}', target);
    case 'broken-link':
      return vscode.l10n.t('Link to a file that does not exist: {0}', target);
    case 'missing-image':
      return vscode.l10n.t('Image that does not exist: {0}', target);
  }
}
