import * as vscode from 'vscode';
import { mermaidBlocks } from '@edtroleis/techdocs-editor-core';
import type { HostMessage } from './protocol';

/** Espera depois da última mudança antes de validar os diagramas. */
const DELAY_MS = 500;

/**
 * Erros de sintaxe dos diagramas Mermaid no painel Problemas (spec 06, M5), só das páginas abertas no editor
 * visual: o Mermaid roda no webview. O host acha os blocos no texto do arquivo (as linhas batem com o arquivo
 * salvo), manda ao webview e mostra o que volta; uma resposta antiga (de antes de outra mudança ou de uma página
 * já fechada) é ignorada.
 */
export class DiagramProblems implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('techdocs-mermaid');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Último pedido mandado ao webview de cada página aberta. */
  private readonly pending = new Map<string, number>();
  private next = 0;

  /** Valida os diagramas da página (depois de um tempo sem mudança). */
  check(document: vscode.TextDocument, post: (message: HostMessage) => void) {
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        const blocks = mermaidBlocks(document.getText().replace(/\r\n/g, '\n'));
        if (!blocks.length) {
          this.pending.delete(key);
          this.diagnostics.delete(document.uri);
          return;
        }
        const id = ++this.next;
        this.pending.set(key, id);
        post({ type: 'diagrams', id, blocks });
      }, DELAY_MS),
    );
  }

  /** Resposta do webview ao pedido `id`. */
  receive(uri: vscode.Uri, id: number, errors: { line: number; message: string }[]) {
    if (this.pending.get(uri.toString()) !== id) return;
    this.diagnostics.set(
      uri,
      errors.map(error => {
        const line = Math.max(error.line - 1, 0);
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
          error.message,
          vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = 'TechDocs';
        diagnostic.code = 'mermaid';
        return diagnostic;
      }),
    );
  }

  /** Página fechada no editor visual: some com os erros e com o pedido em andamento. */
  clear(uri: vscode.Uri) {
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.pending.delete(key);
    this.diagnostics.delete(uri);
  }

  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.diagnostics.dispose();
  }
}
