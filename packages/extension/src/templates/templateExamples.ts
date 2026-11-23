import * as vscode from 'vscode';
import { BUILT_IN_EXAMPLES, type TemplateLanguage } from '@edtroleis/techdocs-editor-core/src/builtInTemplates';
import type { PageChoice } from './templateSources';

/**
 * Páginas de exemplo dos templates (spec 08, TR4). As da extensão vêm da cópia do repositório de templates que
 * está no pacote e abrem na prévia do Markdown, sem rede, como documentos só de leitura
 * (`techdocs-example:/<idioma>/<caminho>`). As da empresa abrem no GitHub.
 */
export const EXAMPLE_SCHEME = 'techdocs-example';

export const exampleUri = (language: TemplateLanguage, path: string) => vscode.Uri.from({ scheme: EXAMPLE_SCHEME, path: `/${language}/${path}` });

/** O texto de um exemplo da cópia, pelo endereço `techdocs-example:`. */
export function exampleText(uri: vscode.Uri): string | undefined {
  const [, language, ...rest] = uri.path.split('/');
  return BUILT_IN_EXAMPLES[language as TemplateLanguage]?.[rest.join('/')];
}

export function registerTemplateExamples(): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(EXAMPLE_SCHEME, { provideTextDocumentContent: uri => exampleText(uri) ?? '' });
}

/** O template tem um exemplo que dá para abrir. */
export const hasExample = (choice: PageChoice) =>
  choice.origin === 'builtIn' ? Boolean(choice.language && choice.template.example && BUILT_IN_EXAMPLES[choice.language][choice.template.example]) : choice.origin === 'central' && Boolean(choice.exampleUrl);

/** Abre o exemplo do template: a prévia da cópia (os da extensão) ou a página no GitHub (os da empresa). */
export async function openTemplateExample(choice: PageChoice): Promise<boolean> {
  if (!hasExample(choice) || choice.origin === 'repository') return false;
  if (choice.origin === 'central') return vscode.env.openExternal(vscode.Uri.parse(choice.exampleUrl!));
  const uri = exampleUri(choice.language!, choice.template.example!);
  await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
  return true;
}
