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
 * editor visual (`onDidLint`). As páginas fechadas do site da árvore (`watchFiles`) são conferidas pelo
 * disco, só para o ⚠ da árvore: o painel Problemas fica com as abertas.
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
  /** As páginas do site da árvore, conferidas pelo disco quando fechadas. */
  private watched = new Set<string>();
  /** Data de modificação do arquivo da última conferência pelo disco: o que não mudou não é conferido de novo. */
  private readonly stamps = new Map<string, number>();
  /** Fila das conferências pelo disco, uma página de cada vez. */
  private readonly diskQueue = new Map<string, vscode.Uri>();
  private diskRunning = false;

  constructor(private readonly sites: LocalSites) {
    const watcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB);
    const configChanged = () => {
      this.configs.clear();
      this.stamps.clear();
      this.lintAll();
    };
    const pages = vscode.workspace.createFileSystemWatcher('**/*.md');
    // Mudou por fora (git pull, outro editor): a página fechada é conferida de novo
    const changedOnDisk = (uri: vscode.Uri) => {
      if (this.watched.has(uri.toString())) this.queueDisk([uri]);
    };
    this.disposables.push(
      this.diagnostics,
      this.lintEmitter,
      watcher,
      watcher.onDidCreate(configChanged),
      watcher.onDidChange(configChanged),
      watcher.onDidDelete(configChanged),
      pages,
      pages.onDidCreate(changedOnDisk),
      pages.onDidChange(changedOnDisk),
      pages.onDidDelete(uri => this.forget(uri)),
      vscode.workspace.onDidOpenTextDocument(document => this.schedule(document, 0)),
      vscode.workspace.onDidChangeTextDocument(({ document }) => this.schedule(document)),
      vscode.workspace.onDidCloseTextDocument(document => this.closed(document.uri)),
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

  /**
   * As páginas do site mostrado na árvore: as fechadas são conferidas pelo disco (o ⚠ delas), e as que saíram da
   * lista (outro site) são esquecidas, se não estão abertas.
   */
  watchFiles(uris: vscode.Uri[]) {
    const next = new Set(uris.map(uri => uri.toString()));
    for (const key of this.watched) {
      if (!next.has(key) && !this.openDocument(key)) this.forget(vscode.Uri.parse(key));
    }
    this.watched = next;
    this.queueDisk(uris);
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
    this.queueDisk([...this.watched].map(key => vscode.Uri.parse(key)));
  }

  private openDocument(key: string) {
    return vscode.workspace.textDocuments.find(d => !d.isClosed && d.uri.toString() === key);
  }

  /** Página fechada: sai do painel Problemas; se é do site da árvore, o ⚠ passa a valer o que está no disco. */
  private closed(uri: vscode.Uri) {
    const key = uri.toString();
    if (!this.watched.has(key)) return this.forget(uri);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.diagnostics.delete(uri);
    this.stamps.delete(key);
    this.queueDisk([uri]);
  }

  private queueDisk(uris: vscode.Uri[]) {
    uris.forEach(uri => this.diskQueue.set(uri.toString(), uri));
    if (!this.diskRunning) void this.runDisk();
  }

  /** Confere a fila pelo disco, com uma pausa entre as páginas (o VS Code não para num site grande). */
  private async runDisk() {
    this.diskRunning = true;
    try {
      for (let next = this.diskQueue.values().next(); !next.done; next = this.diskQueue.values().next()) {
        const uri = next.value;
        this.diskQueue.delete(uri.toString());
        await this.lintFromDisk(uri);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      this.diskRunning = false;
    }
  }

  private async lintFromDisk(uri: vscode.Uri) {
    const key = uri.toString();
    // Aberta: vale o texto do editor
    if (!this.watched.has(key) || this.openDocument(key)) return;
    let mtime: number;
    try {
      mtime = (await vscode.workspace.fs.stat(uri)).mtime;
    } catch {
      return this.forget(uri);
    }
    if (this.stamps.get(key) === mtime && this.results.has(key)) return;
    const config = await this.configFor(uri);
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return this.forget(uri);
    }
    // Abriu ou saiu da lista enquanto lia
    if (!this.watched.has(key) || this.openDocument(key)) return;
    const problems = config ? pageProblems(toLf(text), config, vscode.env.language) : [];
    this.stamps.set(key, mtime);
    const before = this.results.get(key);
    this.results.set(key, problems);
    if (JSON.stringify(before) !== JSON.stringify(problems)) this.lintEmitter.fire({ uri, problems });
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
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.stamps.delete(key);
    const had = (this.results.get(key)?.length ?? 0) > 0;
    this.results.delete(key);
    this.diagnostics.delete(uri);
    if (had) this.lintEmitter.fire({ uri, problems: [] });
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
