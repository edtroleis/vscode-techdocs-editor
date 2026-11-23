// Templates da extensão (spec 04): a cópia do repositório de templates (spec 08, TR3), gerada por
// scripts/sync-templates.mjs em templatesBundle.generated.ts. Fora do index do core para o webview não levá-los:
// quem usa importa este arquivo direto.
import { TEMPLATES_FILES, TEMPLATES_SOURCE } from './templatesBundle.generated';

export type TemplateLanguage = 'en' | 'pt-br';
const LANGUAGES: TemplateLanguage[] = ['en', 'pt-br'];

export { TEMPLATES_SOURCE };

/** Os arquivos de `prefix`, sem ele. */
const under = (prefix: string) =>
  Object.fromEntries(Object.entries(TEMPLATES_FILES).filter(([path]) => path.startsWith(prefix)).map(([path, text]) => [path.slice(prefix.length), text]));

const PAGE = /^(tutorials|how-to-guides|reference|explanation)\/([^/]+)\.md$/;

/** Texto de cada template de página da extensão, por língua e id (nome do arquivo sem `.md`). */
export const BUILT_IN_TEMPLATES: Record<TemplateLanguage, Record<string, string>> = Object.fromEntries(
  LANGUAGES.map(language => [
    language,
    Object.fromEntries(
      Object.entries(under(`templates/${language}/`))
        .map(([path, text]) => [PAGE.exec(path)?.[2], text] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[0]))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  ]),
) as Record<TemplateLanguage, Record<string, string>>;

/**
 * Templates de site da extensão, por língua e id: os arquivos de cada pasta, pelo nome (`template.yml` e os `source`).
 * O em branco vem primeiro: é o padrão quando o repositório e a empresa não têm templates.
 */
export const BUILT_IN_SITES: Record<TemplateLanguage, Record<string, Record<string, string>>> = Object.fromEntries(
  LANGUAGES.map(language => {
    const sites: Record<string, Record<string, string>> = {};
    for (const [path, text] of Object.entries(under(`templates/${language}/sites/`))) {
      const [id, ...rest] = path.split('/');
      if (rest.length) (sites[id] ??= {})[rest.join('/')] = text;
    }
    const ids = Object.keys(sites).sort((a, b) => (a === 'blank' ? -1 : b === 'blank' ? 1 : a.localeCompare(b)));
    return [language, Object.fromEntries(ids.map(id => [id, sites[id]]))];
  }),
) as Record<TemplateLanguage, Record<string, Record<string, string>>>;

/** As páginas de exemplo preenchidas (spec 08), por língua e caminho relativo ao `docs/` do site de exemplo. */
export const BUILT_IN_EXAMPLES: Record<TemplateLanguage, Record<string, string>> = Object.fromEntries(
  LANGUAGES.map(language => [language, under(`examples/${language}/docs/`)]),
) as Record<TemplateLanguage, Record<string, string>>;

/** Língua dos templates pela do VS Code: português para `pt*`, senão inglês (TP9). */
export const templateLanguage = (language: string): TemplateLanguage => (language.toLowerCase().startsWith('pt') ? 'pt-br' : 'en');
