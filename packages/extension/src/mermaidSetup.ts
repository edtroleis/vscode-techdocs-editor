import * as vscode from 'vscode';
import { addMermaidConfig, MERMAID_COLORS_FILE, MERMAID_COLORS_SCRIPT } from '@edtroleis/techdocs-editor-core';
import type { LocalSites } from './localSites';
import { currentText, replaceText, showMessage, type Ask } from './repoCheck';

/**
 * Diagrama inserido no editor visual (spec 06, M7 e M25): se o site da página ainda não configura o Mermaid,
 * acrescenta a configuração ao `mkdocs.yml` (o bloco do superfences e as cores do editor no `extra_javascript`),
 * cria o script das cores no `docs_dir` e avisa, com **Desfazer**. Página fora de um site, ou site já configurado:
 * nada.
 */
export async function configureMermaid(page: vscode.Uri, sites: LocalSites, ask: Ask = showMessage): Promise<void> {
  const site = sites.siteOf(page);
  if (!site) return;
  const mkdocs = sites.all().find(entry => entry.site.root === site.root && entry.site.docsDir === site.docsDir)?.mkdocs;
  if (!mkdocs) return;
  const before = await currentText(mkdocs);
  if (before === undefined) return;
  const after = addMermaidConfig(before);
  const script = mkdocs.with({ path: `${site.docsDir}/${MERMAID_COLORS_FILE}` });
  const createScript = (await currentText(script)) === undefined;
  if (after === before && !createScript) return;
  if (after !== before) await replaceText(mkdocs, after);
  if (createScript) await vscode.workspace.fs.writeFile(script, new TextEncoder().encode(MERMAID_COLORS_SCRIPT));
  const undo = vscode.l10n.t('Undo');
  const choice = await ask('info', vscode.l10n.t('Configured Mermaid diagrams in {0}.', vscode.workspace.asRelativePath(mkdocs, false)), undo);
  if (choice !== undo) return;
  if (after !== before && (await currentText(mkdocs)) === after) await replaceText(mkdocs, before);
  if (createScript && (await currentText(script)) === MERMAID_COLORS_SCRIPT) await vscode.workspace.fs.delete(script);
}
