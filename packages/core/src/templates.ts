import { isMap, isScalar, parseDocument } from 'yaml';

/** Versão do formato que esta extensão entende (spec 04, "Onde ficam e como evoluem"). */
export const TEMPLATE_FORMAT_VERSION = 1;

/** As quatro categorias do Diátaxis: aprender, fazer uma tarefa, consultar, entender. */
export type TemplateCategory = 'tutorial' | 'guide' | 'reference' | 'explanation';
export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['tutorial', 'guide', 'reference', 'explanation'];

export type TemplateField = { name: string; prompt: string; default: string };

export type DocTemplate = {
  /** Nome do arquivo sem `.md`: o mesmo nas línguas e o que um template do repositório sobrepõe. */
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Pasta sugerida, relativa ao `docs_dir`. */
  folder?: string;
  /** Nome do arquivo com número (`0007-titulo.md`), como os ADRs. */
  numbered: boolean;
  version: number;
  /** Campos que o template declara (os automáticos, como `title`, não entram). */
  fields: TemplateField[];
  /** A página, sem o bloco `template:` do front matter. */
  body: string;
};

/** Campos preenchidos sem perguntar (TP5). */
export const AUTOMATIC_FIELDS = ['title', 'date', 'site_name', 'owner'];

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : value == null ? fallback : String(value));

/**
 * Lê um template: o bloco `template:` do front matter e o corpo. Arquivo sem o bloco não é template
 * (undefined): numa pasta de templates, um README ao lado não vira opção.
 */
export function parseTemplate(id: string, source: string): DocTemplate | undefined {
  const match = source.match(FRONT_MATTER);
  if (!match) return undefined;
  const doc = parseDocument(match[1]);
  if (doc.errors.length || !isMap(doc.contents)) return undefined;
  const meta = doc.get('template', true);
  if (!isMap(meta)) return undefined;
  const info = meta.toJSON() as Record<string, unknown>;
  const fieldsNode = info.fields;
  const fields: TemplateField[] =
    fieldsNode && typeof fieldsNode === 'object' && !Array.isArray(fieldsNode)
      ? Object.entries(fieldsNode as Record<string, unknown>)
          .filter(([name]) => !AUTOMATIC_FIELDS.includes(name) || name === 'owner')
          .map(([name, value]) => {
            const field = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
            return { name, prompt: text(field.prompt, name), default: text(field.default) };
          })
      : [];
  const category = TEMPLATE_CATEGORIES.includes(info.category as TemplateCategory) ? (info.category as TemplateCategory) : 'reference';
  const version = typeof info.version === 'number' ? info.version : 1;

  // O bloco `template:` sai da página; o resto do front matter (ex.: tags) fica como está
  doc.delete('template');
  const rest = isMap(doc.contents) && doc.contents.items.length ? `---\n${doc.toString()}---\n` : '';
  const body = rest + source.slice(match[0].length).replace(/^\r?\n/, rest ? '\n' : '');
  return {
    id,
    name: text(info.name, id),
    description: text(info.description),
    category,
    folder: typeof info.folder === 'string' && info.folder.trim() ? info.folder.trim().replace(/^\/+|\/+$/g, '') : undefined,
    numbered: info.numbered === true,
    version,
    fields,
    body,
  };
}

/** O template é de uma versão do formato mais nova que esta extensão: aparece desligado. */
export const isTemplateSupported = (template: DocTemplate) => template.version <= TEMPLATE_FORMAT_VERSION;

/** Troca `{{campo}}` pelo valor; campo sem valor vira vazio; `{{` sem `}}` fica como está. */
export const fillTemplate = (body: string, values: Record<string, string>) =>
  body.replace(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g, (_, name: string) => values[name] ?? '');

/** Campos usados no corpo (para saber o que perguntar). */
export const usedFields = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g)].map(m => m[1]))];

/** Nome do arquivo a partir do título: minúsculas, sem acento, palavras com `-` (`Guia de deploy` → `guia-de-deploy.md`). */
export function fileNameFor(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug || 'pagina'}.md`;
}

/** Próximo número de uma pasta numerada (ADRs): `0001` sem arquivos, senão o maior + 1. */
export function nextNumber(existing: string[]): string {
  const numbers = existing.map(name => name.match(/^(\d+)-/)?.[1]).filter(Boolean).map(Number);
  return String(Math.max(0, ...numbers) + 1).padStart(4, '0');
}

/**
 * Caminho da página nova, relativo ao `docs_dir`, ou undefined se sair dele (TP4): pasta ou nome com
 * `..`, caminho absoluto ou nome vazio.
 */
export function pagePath(folder: string, fileName: string): string | undefined {
  const parts = [...folder.split(/[\\/]+/), ...fileName.split(/[\\/]+/)].filter(Boolean);
  if (!parts.length || parts.some(p => p === '..' || p === '.') || /^[\\/]/.test(fileName) || /^[A-Za-z]:/.test(fileName)) {
    return undefined;
  }
  const path = parts.join('/');
  return path.endsWith('.md') ? path : undefined;
}

/** Hoje como `AAAA-MM-DD` (campo `date`). */
export const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** `spec.owner` de um `catalog-info.yaml` (o primeiro documento que tiver), para o campo `owner`. */
export function catalogOwner(catalogInfo: string): string | undefined {
  for (const part of catalogInfo.split(/^---\s*$/m)) {
    const doc = parseDocument(part);
    const owner = doc.getIn(['spec', 'owner'], true);
    if (isScalar(owner) && typeof owner.value === 'string' && owner.value.trim()) return owner.value.trim();
  }
  return undefined;
}

/**
 * Templates na ordem da lista (TP2): os do repositório primeiro (sobrepondo os da extensão de mesmo id),
 * depois os da extensão; dentro de cada origem, por categoria e nome.
 */
export function mergeTemplates<T extends { template: DocTemplate }>(repository: T[], builtIn: T[]): T[] {
  const ids = new Set(repository.map(t => t.template.id));
  const order = (list: T[]) =>
    [...list].sort(
      (a, b) =>
        TEMPLATE_CATEGORIES.indexOf(a.template.category) - TEMPLATE_CATEGORIES.indexOf(b.template.category) ||
        a.template.name.localeCompare(b.template.name),
    );
  return [...order(repository), ...order(builtIn.filter(t => !ids.has(t.template.id)))];
}

/**
 * Primeiro trecho a preencher de uma página criada de template (TP7): o texto de exemplo da primeira seção (o
 * primeiro parágrafo ou item de lista depois do primeiro título 2), sem o marcador da lista. undefined se a
 * página não tem seção com texto (só tabela ou código, por exemplo).
 */
export function firstToFill(markdown: string): string | undefined {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => /^##\s/.test(line));
  if (start < 0) return undefined;
  let fence: string | undefined;
  for (const line of lines.slice(start + 1)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (!line.trim() || /^#{1,6}\s/.test(line) || /^\s*\|/.test(line)) continue;
    const text = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '').replace(/^>\s?/, '').trim();
    // Com marcação no meio (negrito, link, código), o texto do editor não é o do arquivo
    if (text && !/[*_`[\]<>]/.test(text)) return text;
  }
  return undefined;
}
