import { pageRefs } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import { onAttached } from './attachments';
import type { LocalSites } from './localSites';
import { type Ask, type RepoCheck, showMessage } from './repoCheck';

/**
 * Anexo que sai da página (spec 07, revisada na 0.22): ao salvar, os anexos que a página citava e não cita mais, que
 * nenhuma outra página nem o `mkdocs.yml` usa (a mesma conferência da Verificação), ganham a pergunta "Apagar?". Nada
 * sai sozinho: o Ctrl+Z que traz o link de volta continua valendo. Manter: não pergunta de novo sobre o arquivo.
 */
export class UnusedAttachments implements vscode.Disposable {
  /** Os arquivos que cada página citava no último retrato (ao abrir, ao salvar, ao anexar). */
  private readonly known = new Map<string, Set<string>>();
  private readonly kept = new Set<string>();
  private readonly running = new Set<Promise<unknown>>();
  private readonly disposables: vscode.Disposable[] = [];
  private ask: Ask = showMessage;

  constructor(
    private readonly repoCheck: Pick<RepoCheck, 'siteFindings'>,
    private readonly sites: Pick<LocalSites, 'list'>,
  ) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(document => this.remember(document)),
      vscode.workspace.onDidCloseTextDocument(document => this.known.delete(document.uri.toString())),
      vscode.workspace.onDidSaveTextDocument(document => this.track(this.saved(document))),
      onAttached(({ page, file }) => this.known.get(page.toString())?.add(file.toString())),
    );
    vscode.workspace.textDocuments.forEach(document => this.remember(document));
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }

  /** Testes: as respostas prontas (undefined volta às perguntas de verdade). */
  useTestAnswers(ask: Ask | undefined) {
    this.ask = ask ?? showMessage;
  }

  /** Testes: espera as perguntas em andamento. */
  async settled() {
    while (this.running.size) await Promise.all([...this.running]);
  }

  private track(work: Promise<unknown>) {
    const done = work.catch(() => undefined).finally(() => this.running.delete(done));
    this.running.add(done);
  }

  private siteOf(uri: vscode.Uri) {
    return this.sites.list().find(({ mkdocs, site }) => mkdocs.scheme === uri.scheme && uri.path.startsWith(`${site.docsDir}/`));
  }

  private refs(document: vscode.TextDocument): Set<string> {
    const dir = vscode.Uri.joinPath(document.uri, '..');
    const files = pageRefs(document.getText()).map(ref => {
      const path = ref.target.replace(/[#?].*$/, '');
      let decoded = path;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        // fica como está
      }
      return vscode.Uri.joinPath(dir, decoded).toString();
    });
    return new Set(files);
  }

  private remember(document: vscode.TextDocument) {
    if (/\.md$/i.test(document.uri.path) && this.siteOf(document.uri)) this.known.set(document.uri.toString(), this.refs(document));
  }

  private async saved(document: vscode.TextDocument) {
    const site = /\.md$/i.test(document.uri.path) ? this.siteOf(document.uri) : undefined;
    if (!site) return;
    const before = this.known.get(document.uri.toString()) ?? new Set<string>();
    const now = this.refs(document);
    this.known.set(document.uri.toString(), now);
    const gone = [...before].filter(file => !now.has(file) && !this.kept.has(file));
    if (!gone.length) return;
    const check = await this.repoCheck.siteFindings(site.mkdocs);
    if (!check) return;
    const unused = new Set(check.findings.filter(f => f.code === 'attachment-unused').map(f => vscode.Uri.joinPath(check.base, f.file).toString()));
    for (const file of gone.filter(f => unused.has(f))) {
      const uri = vscode.Uri.parse(file);
      const name = decodeURIComponent(uri.path.split('/').pop() ?? '');
      const remove = vscode.l10n.t('Delete');
      const keep = vscode.l10n.t('Keep');
      const answer = await this.ask('info', vscode.l10n.t('{0} is no longer used by any page. Delete it?', name), remove, keep);
      if (answer === keep) this.kept.add(file);
      if (answer !== remove) continue;
      const bytes = await Promise.resolve(vscode.workspace.fs.readFile(uri)).then(
        b => b,
        () => undefined,
      );
      if (!bytes) continue;
      await vscode.workspace.fs.delete(uri);
      const undo = vscode.l10n.t('Undo');
      // Sem esperar: o aviso pode ficar no canto, e as próximas perguntas não ficam presas a ele
      this.track(
        Promise.resolve(this.ask('info', vscode.l10n.t('{0} deleted.', name), undo)).then(async choice => {
          if (choice === undo) await vscode.workspace.fs.writeFile(uri, bytes);
          await this.repoCheck.siteFindings(site.mkdocs);
        }),
      );
    }
  }
}
