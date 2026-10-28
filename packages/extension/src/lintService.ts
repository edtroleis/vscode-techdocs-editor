import * as vscode from 'vscode';
import type { Configuration } from 'markdownlint';
import { DEFAULT_LINT_CONFIG, LINT_CONFIG_FILES, parseLintConfig } from '@edtroleis/techdocs-editor-core';
import type { LocalSites } from './localSites';
import { PageProblem, configDirs, fixedText, pageProblems } from './lintProblems';
import { minimalEdit, toEol, toLf } from './textSync';

/** Extensão do markdownlint: com ela instalada, os diagnostics ficam com ela (spec 01, L-6). */
export const MARKDOWNLINT_EXTENSION = 'DavidAnson.vscode-markdownlint';
const DELAY_MS = 400;
const CONFIG_GLOB = '**/.markdownlint.{jsonc,json,yaml,yml}';
export const DIAGNOSTIC_SOURCE = 'TechDocs';

/**
 * Lint das páginas de docs (spec 01, L-1 a L-6): o markdownlint do `core` com a configuração da
 * pipeline, 400 ms depois de parar de digitar. Os problemas vão para o painel Problemas e para o
 * editor visual (`onDidLint`).
 */
export class LintService implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('techdocs-editor');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly results = new Map<string, PageProblem[]>();
  /** Configuração por pasta (null: a pasta não tem arquivo de configuração). */
  private readonly configs = new Map<string, Configuration | null>();
  private readonly lintEmitter = new vscode.EventEmitter<{ uri: vscode.Uri; problems: PageProblem[] }>();
  /** Lint de uma página terminou (também quando ela deixou de ter problemas). */
  readonly onDidLint = this.lintEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly sites: LocalSites) {
    const watcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
    const configChanged = () => {
      this.configs.clear();
      this.lintAll();
    };
    this.disposables.push(
      this.diagnostics,
      this.lintEmitter,
      watcher,
      watcher.onDidCreate(configChanged),
      watcher.onDidChange(configChanged),
      watcher.onDidDelete(configChanged),
      vscode.workspace.onDidOpenTextDocument(document => this.schedule(document, 0)),
      vscode.workspace.onDidChangeTextDocument(({ document }) => this.schedule(document)),
      vscode.workspace.onDidCloseTextDocument(document => this.forget(document.uri)),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.lintAll()),
      vscode.extensions.onDidChange(() => this.lintAll()),
      sites.onDidChange(() => this.lintAll()),
    );
    void sites.ready.then(() => this.lintAll());
  }

  /** Últimos problemas da página (vazio se ela não é de docs ou não tem problemas). */
  problems(uri: vscode.Uri): PageProblem[] {
    return this.results.get(uri.toString()) ?? [];
  }

  /** Lint agora, sem esperar a pausa na digitação (testes e "Ajustar agora"). */
  async lintNow(document: vscode.TextDocument): Promise<PageProblem[]> {
    await this.lint(document);
    return this.problems(document.uri);
  }

  /** Edição com as correções automáticas da página (L-4), ou undefined se não há o que corrigir. */
  async fixEdit(document: vscode.TextDocument): Promise<vscode.WorkspaceEdit | undefined> {
    const config = await this.configFor(document.uri);
    if (!config) return undefined;
    const fixed = fixedText(toLf(document.getText()), config);
    if (fixed === undefined) return undefined;
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const file = document.getText();
    const { start, end, text } = minimalEdit(file, toEol(fixed, eol));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
    return edit;
  }

  dispose() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.disposables.forEach(d => d.dispose());
  }

  private lintAll() {
    vscode.workspace.textDocuments.forEach(document => this.schedule(document, 0));
  }

  private schedule(document: vscode.TextDocument, delay = DELAY_MS) {
    if (document.languageId !== 'markdown' && !/\.md$/i.test(document.uri.path)) return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.lint(document);
      }, delay),
    );
  }

  private async lint(document: vscode.TextDocument) {
    if (document.isClosed) return;
    const config = await this.configFor(document.uri);
    const problems = config ? pageProblems(toLf(document.getText()), config, vscode.env.language) : [];
    this.results.set(document.uri.toString(), problems);
    this.diagnostics.set(document.uri, this.markdownlintInstalled() ? [] : problems.map(p => diagnostic(document, p)));
    this.lintEmitter.fire({ uri: document.uri, problems });
  }

  private forget(uri: vscode.Uri) {
    clearTimeout(this.timers.get(uri.toString()));
    this.timers.delete(uri.toString());
    this.results.delete(uri.toString());
    this.diagnostics.delete(uri);
  }

  private markdownlintInstalled() {
    return vscode.extensions.all.some(e => e.id.toLowerCase() === MARKDOWNLINT_EXTENSION.toLowerCase());
  }

  /**
   * Configuração da pipeline para a página, ou undefined se ela não é página de docs ou o workspace não
   * é confiável (a configuração do repositório só vale depois de confiar, spec 02).
   */
  async configFor(uri: vscode.Uri): Promise<Configuration | undefined> {
    if (!vscode.workspace.isTrusted) return undefined;
    const site = this.sites.siteOf(uri);
    if (!site) return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    for (const dir of configDirs(site.root, folder?.uri.path ?? site.root)) {
      const config = await this.configIn(uri.with({ path: dir }));
      if (config) return config;
    }
    return DEFAULT_LINT_CONFIG;
  }

  private async configIn(dir: vscode.Uri): Promise<Configuration | null> {
    const key = dir.toString();
    if (this.configs.has(key)) return this.configs.get(key)!;
    let config: Configuration | null = null;
    for (const name of LINT_CONFIG_FILES) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
        config = parseLintConfig(name, new TextDecoder().decode(bytes));
        break;
      } catch {
        // Sem este arquivo (ou ilegível): tenta o próximo nome
      }
    }
    this.configs.set(key, config);
    return config;
  }
}

function diagnostic(document: vscode.TextDocument, problem: PageProblem): vscode.Diagnostic {
  const line = document.lineAt(Math.min(problem.line, document.lineCount) - 1);
  const range = line.isEmptyOrWhitespace
    ? line.range
    : new vscode.Range(line.lineNumber, line.firstNonWhitespaceCharacterIndex, line.lineNumber, line.text.length);
  const result = new vscode.Diagnostic(range, problem.message, vscode.DiagnosticSeverity.Warning);
  result.source = DIAGNOSTIC_SOURCE;
  result.code = {
    value: problem.rule,
    target: vscode.Uri.parse(`https://github.com/DavidAnson/markdownlint/blob/main/doc/${problem.rule.toLowerCase()}.md`),
  };
  return result;
}
