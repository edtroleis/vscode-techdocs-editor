/**
 * Gera o repositório de vitrine para o Backstage (spec 03, "Vitrine no Backstage"): cada template de página, cada
 * template de site e os exemplos, nas duas línguas, preenchidos pelo mesmo código da extensão (os templates da tag
 * que vem no core), e todos os diagramas Mermaid: os modelos da galeria do editor e os exemplos do mermaid.js.org.
 *
 * Uso: node <bundle> <diretório de saída>. Escreve um site MkDocs por entidade (`<nome>/mkdocs.yml` e `docs/`), o
 * `catalog-info.yaml` com todas as entidades e o `manifest.json` com as páginas e os diagramas de cada uma (o que o
 * passo de conferência espera ver no Backstage).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { BUILT_IN_SITES, BUILT_IN_TEMPLATES } from '../../packages/core/src/builtInTemplates';
import { addMermaidFence, mermaidBlocks } from '../../packages/core/src/mermaidConfig';
import { buildSitePages, parseSiteTemplate, siteMkdocsYml } from '../../packages/core/src/siteTemplates';
import { TEMPLATES_FILES, TEMPLATES_SOURCE } from '../../packages/core/src/templatesBundle.generated';
import { TEMPLATE_CATEGORIES, fillTemplate, parseTemplate, type DocTemplate } from '../../packages/core/src/templates';
import { DIAGRAM_GROUPS, DIAGRAM_TEMPLATES } from '../../packages/ui/src/diagramTemplates';
import { en } from '../../packages/ui/src/messages/en';
import { ptBR } from '../../packages/ui/src/messages/pt-BR';
import mermaidSite from '../../packages/ui/e2e/fixtures/mermaid-site-examples.json';

type Language = 'en' | 'pt-br';
export type ManifestPage = { path: string; title: string; mermaid: number };
export type ManifestEntity = { name: string; title: string; group: string; language: Language | 'both'; dir: string; pages: ManifestPage[] };

const out = process.argv[2];
if (!out) throw new Error('uso: generate <diretório de saída>');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const OWNER = 'platform-team';
const DATE = '2026-11-24';
const LANGUAGES: Language[] = ['en', 'pt-br'];
const entities: ManifestEntity[] = [];

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** Um site: as páginas (caminho no docs/ → texto) e o mkdocs.yml; o fence do Mermaid entra quando alguma página tem diagrama. */
function site(entity: Omit<ManifestEntity, 'dir' | 'pages'>, mkdocsYml: string, pages: { path: string; title: string; content: string }[]) {
  const dir = entity.name;
  const hasMermaid = pages.some(p => mermaidBlocks(p.content).length);
  write(join(out, dir, 'mkdocs.yml'), hasMermaid ? addMermaidFence(mkdocsYml) : mkdocsYml);
  for (const page of pages) write(join(out, dir, 'docs', page.path), page.content);
  entities.push({ ...entity, dir, pages: pages.map(p => ({ path: p.path, title: p.title, mermaid: mermaidBlocks(p.content).length })) });
}

const mkdocs = (siteName: string, nav: unknown[]) => stringify({ site_name: siteName, nav, plugins: ['techdocs-core'] }, { lineWidth: 0 });

/** Valores de exemplo: os automáticos e o padrão de cada campo que o template declara. */
const valuesFor = (title: string, fields: { name: string; default: string }[], siteName: string) => ({
  ...Object.fromEntries(fields.map(f => [f.name, f.default ?? ''])),
  title,
  date: DATE,
  owner: OWNER,
  site_name: siteName,
});

const CATEGORY_TITLES: Record<Language, Record<string, string>> = {
  en: { tutorial: 'Tutorials', guide: 'How-to guides', reference: 'Reference', explanation: 'Explanation' },
  'pt-br': { tutorial: 'Tutoriais', guide: 'Guias', reference: 'Referência', explanation: 'Explicação' },
};

for (const language of LANGUAGES) {
  const tag = language === 'en' ? 'en' : 'pt-br';
  const label = language === 'en' ? 'English' : 'Português';

  // 1. Os templates de página, um por página, preenchidos com os valores de exemplo, pelas categorias do Diátaxis
  const templates = Object.entries(BUILT_IN_TEMPLATES[language])
    .map(([id, text]) => parseTemplate(id, text))
    .filter((t): t is DocTemplate => Boolean(t));
  const siteName = language === 'en' ? 'Page templates' : 'Templates de página';
  const home = `# ${siteName}\n\n${
    language === 'en'
      ? 'Every page template of the TechDocs Editor extension, filled in with sample values, as it lands in Backstage.'
      : 'Cada template de página da extensão TechDocs Editor, preenchido com valores de exemplo, como fica no Backstage.'
  }\n`;
  const pages = [
    { path: 'index.md', title: siteName, content: home },
    ...templates.map(t => ({ path: `${t.category}/${t.id}.md`, title: t.name, content: fillTemplate(t.body, valuesFor(t.name, t.fields, siteName)) })),
  ];
  const nav = [
    { [language === 'en' ? 'Home' : 'Início']: 'index.md' },
    ...TEMPLATE_CATEGORIES.filter(c => templates.some(t => t.category === c)).map(c => ({
      [CATEGORY_TITLES[language][c]]: templates.filter(t => t.category === c).map(t => ({ [t.name]: `${c}/${t.id}.md` })),
    })),
  ];
  site({ name: `showcase-pages-${tag}`, title: `${siteName} (${label})`, group: 'pages', language }, mkdocs(siteName, nav), pages);

  // 2. Os templates de site, como o "Novo site" da extensão cria
  for (const [id, files] of Object.entries(BUILT_IN_SITES[language])) {
    const template = parseSiteTemplate(id, files['template.yml'] ?? '');
    if (!template) throw new Error(`template de site ${language}/${id} inválido`);
    const pageOf = (page: string) => parseTemplate(page, BUILT_IN_TEMPLATES[language][page] ?? '');
    const fields = [...template.fields, ...template.files.flatMap(f => (f.page && pageOf(f.page)?.fields) || [])];
    const values = valuesFor('', fields, template.name);
    const built = buildSitePages(template, file => (file.page ? pageOf(file.page)?.body : files[file.source!]), values);
    site(
      { name: `showcase-site-${id}-${tag}`, title: `${template.name} (${label})`, group: 'sites', language },
      siteMkdocsYml(template.name, built, template),
      built,
    );
  }

  // 3. Os exemplos preenchidos do repositório de templates, com o mkdocs.yml deles
  const prefix = `examples/${language}/`;
  const exampleFiles = Object.entries(TEMPLATES_FILES).filter(([path]) => path.startsWith(`${prefix}docs/`));
  const exampleYml = TEMPLATES_FILES[`${prefix}mkdocs.yml`];
  if (!exampleYml) throw new Error(`sem ${prefix}mkdocs.yml`);
  site(
    { name: `showcase-examples-${tag}`, title: `${language === 'en' ? 'Examples' : 'Exemplos'} (${label})`, group: 'examples', language },
    exampleYml,
    exampleFiles.map(([path, content]) => ({
      path: path.slice(`${prefix}docs/`.length),
      title: /^#\s+(.+)$/m.exec(content)?.[1] ?? path,
      content,
    })),
  );
}

// 4. Os modelos de diagrama da galeria do editor, nas duas línguas, uma página por grupo
const fence = (code: string) => `\`\`\`mermaid\n${code}\n\`\`\`\n`;
const GROUP_TITLES: Record<string, string> = { flows: 'Flows', structure: 'Structure', planning: 'Planning', charts: 'Charts', ideas: 'Ideas' };
{
  const pages = [
    {
      path: 'index.md',
      title: 'Mermaid gallery',
      content:
        '# Mermaid gallery\n\nEvery diagram template of the editor gallery (the toolbar diagram button and the `/` menu), in English and ' +
        'Portuguese. Types marked "since" need a Mermaid at least that new in the Backstage Mermaid addon.\n',
    },
  ];
  for (const group of DIAGRAM_GROUPS) {
    const sections = DIAGRAM_TEMPLATES.filter(t => t.group === group).map(t => {
      const sampleKey = t.key === 'flow' ? 'editorText.diagramSample' : `editorText.diagramSample${t.name}`;
      const since = t.since ? `\n> Since Mermaid ${t.since}.\n` : '';
      return `## ${en[`editorText.diagram${t.name}`]}\n${since}\n### English\n\n${fence(en[sampleKey])}\n### Português\n\n${fence(ptBR[sampleKey])}`;
    });
    pages.push({ path: `${group}.md`, title: GROUP_TITLES[group], content: `# ${GROUP_TITLES[group]}\n\n${sections.join('\n')}` });
  }
  site(
    { name: 'showcase-mermaid-gallery', title: 'Mermaid: editor gallery', group: 'mermaid', language: 'both' },
    mkdocs('Mermaid: editor gallery', pages.map(p => ({ [p.title]: p.path }))),
    pages,
  );
}

// 5. Todos os exemplos da documentação do Mermaid (mermaid.js.org), uma página por página de lá
{
  type Example = { page: string; n: number; code: string };
  const byPage = new Map<string, Example[]>();
  for (const example of (mermaidSite as { examples: Example[] }).examples) {
    const list = byPage.get(example.page) ?? [];
    list.push(example);
    byPage.set(example.page, list);
  }
  const pages = [
    {
      path: 'index.md',
      title: 'Mermaid docs',
      content: `# Mermaid docs\n\nEvery example of <${(mermaidSite as { source: string }).source}> (synced ${(mermaidSite as { syncedAt: string }).syncedAt}), drawn by the Backstage Mermaid addon.\n`,
    },
  ];
  for (const [page, examples] of byPage) {
    const slug = page.replace(/\/$/, '').replace(/[^\w-]+/g, '-') || 'root';
    const title = page.replace(/\/$/, '') || 'root';
    const body = examples.map(e => `## Example ${e.n}\n\n${fence(e.code)}`).join('\n');
    pages.push({ path: `${slug}.md`, title, content: `# ${title}\n\nSource: <https://mermaid.js.org/${page}>\n\n${body}` });
  }
  site(
    { name: 'showcase-mermaid-docs', title: 'Mermaid: mermaid.js.org examples', group: 'mermaid', language: 'both' },
    mkdocs('Mermaid: mermaid.js.org examples', pages.map(p => ({ [p.title]: p.path }))),
    pages,
  );
}

// O catalog-info.yaml com todas as entidades e o manifesto para a conferência
const catalog = entities
  .map(e =>
    stringify(
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          name: e.name,
          title: `Vitrine: ${e.title}`,
          description: `TechDocs Editor showcase (${e.group}), templates ${TEMPLATES_SOURCE.ref}`,
          tags: ['techdocs-editor-showcase', e.group],
          annotations: { 'backstage.io/techdocs-ref': `dir:./${e.dir}` },
        },
        spec: { type: 'documentation', lifecycle: 'experimental', owner: OWNER },
      },
      { lineWidth: 0 },
    ),
  )
  .join('---\n');
write(join(out, 'catalog-info.yaml'), catalog);
write(join(out, 'manifest.json'), JSON.stringify({ templates: TEMPLATES_SOURCE, entities }, null, 1));
const total = entities.reduce((n, e) => n + e.pages.length, 0);
const diagrams = entities.reduce((n, e) => n + e.pages.reduce((m, p) => m + p.mermaid, 0), 0);
console.log(`${entities.length} docs, ${total} páginas, ${diagrams} diagramas Mermaid em ${out}`);
