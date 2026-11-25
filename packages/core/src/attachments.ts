/**
 * Anexos e imagens (spec 07, revisada na 0.22): o nome do arquivo, os tipos aceitos, onde ele é gravado e o texto do
 * link na página. Só regras puras: a extensão lê a configuração e grava.
 */
import { relativePath } from './mkdocs';

/** Extensões de fábrica das imagens (as que o editor já aceitava). */
export const DEFAULT_IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
/** Extensões de fábrica dos outros anexos. */
export const DEFAULT_FILE_TYPES = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
  'csv', 'tsv', 'txt', 'json', 'yaml', 'yml', 'xml', 'drawio', 'zip', 'gz', 'tar',
];
/** Nunca entram, nem com `*`: executáveis e scripts, e `md` (o MkDocs publicaria como página). */
export const BLOCKED_TYPES = ['exe', 'msi', 'bat', 'cmd', 'com', 'ps1', 'sh', 'bash', 'zsh', 'app', 'dmg', 'jar', 'vbs', 'scr', 'js', 'mjs', 'html', 'htm', 'md'];

/** Diretórios padrão, relativos ao `docs_dir`, e limites em MB. */
export const DEFAULT_IMAGES_DIR = 'images';
export const DEFAULT_FILES_DIR = 'assets';
export const DEFAULT_IMAGES_MAX_MB = 5;
export const DEFAULT_FILES_MAX_MB = 20;

const extensionOf = (name: string) => {
  const match = /\.([^./\\]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
};

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * O nome no repositório: sem acento, minúsculas, `-` no lugar de espaços e símbolos, extensão em minúsculas
 * (`Manual do Cliente.pdf` → `manual-do-cliente.pdf`). Sem nome: `imagem-AAAAMMDD-HHMM.<ext>`.
 */
export function cleanFileName(name: string, now = new Date(), fallbackExtension = ''): string {
  const extension = extensionOf(name) || fallbackExtension.toLowerCase();
  const base = slug(extensionOf(name) ? name.slice(0, -(extension.length + 1)) : name);
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const named = base || (name.trim() ? 'arquivo' : `imagem-${stamp}`);
  return extension ? `${named}.${extension}` : named;
}

/** `manual.pdf` com o sufixo n (`manual-2.pdf`): o nome já existe com outro conteúdo. */
export function withSuffix(name: string, n: number): string {
  const extension = extensionOf(name);
  return extension ? `${name.slice(0, -(extension.length + 1))}-${n}.${extension}` : `${name}-${n}`;
}

/**
 * O campo de tipos da janela Configurações: separados por vírgula (espaço e `;` também valem), sem o ponto, em
 * minúsculas, sem repetidos. Vazio: undefined (volta ao padrão). `*` libera tudo. Os recusados ficam de fora.
 */
export function parseTypes(text: string): { types: string[] | undefined; refused: string[] } {
  const all = [...new Set(text.split(/[\s,;]+/).map(t => t.trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(Boolean))];
  const refused = all.filter(t => BLOCKED_TYPES.includes(t));
  const types = all.filter(t => !BLOCKED_TYPES.includes(t));
  if (types.includes('*')) return { types: ['*'], refused };
  return { types: types.length ? types : undefined, refused };
}

const allows = (list: string[], extension: string) => list.includes('*') || list.includes(extension);

/** Imagem, anexo, ou recusado: `blocked` (nunca entra) ou `notAllowed` (fora das duas listas). */
export function attachmentKind(name: string, lists: { imageTypes: string[]; fileTypes: string[] }): 'image' | 'file' | 'blocked' | 'notAllowed' {
  const extension = extensionOf(name);
  if (!extension) return lists.fileTypes.includes('*') ? 'file' : 'notAllowed';
  if (BLOCKED_TYPES.includes(extension)) return 'blocked';
  // Uma imagem com `*` na lista das imagens: só as extensões de imagem de verdade (um PDF não vira imagem)
  const imageList = lists.imageTypes.includes('*') ? [...DEFAULT_IMAGE_TYPES, 'avif', 'bmp', 'ico'] : lists.imageTypes;
  if (imageList.includes(extension)) return 'image';
  if (allows(lists.fileTypes, extension)) return 'file';
  return 'notAllowed';
}

/**
 * Onde gravar e o link na página. `dir` é relativo ao `docs_dir`; página fora de um site grava ao lado dela.
 * Caminhos absolutos, com `/`.
 */
export function attachmentTarget(pagePath: string, docsDir: string | undefined, dir: string, fileName: string) {
  const pageDir = pagePath.split('/').slice(0, -1).join('/');
  const inside = dir.split('/').filter(Boolean).join('/');
  const path = `${docsDir ?? pageDir}/${inside ? `${inside}/` : ''}${fileName}`;
  return { path, link: relativePath(pageDir, path) };
}

/** Tamanho legível na língua: `2,3 MB`, `1.5 KB`, `300 B`. */
export function formatSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(value);
  return `${number} ${units[unit]}`;
}

/**
 * O texto do link: o nome original legível (sem a extensão, `-` e `_` viram espaço, primeira letra maiúscula), o
 * tipo e o tamanho (`Manual do cliente (PDF, 2,3 MB)`).
 */
export function attachmentLinkText(name: string, size: number, locale: string): string {
  const extension = extensionOf(name);
  const base = (extension ? name.slice(0, -(extension.length + 1)) : name).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || name;
  const readable = base.charAt(0).toUpperCase() + base.slice(1);
  const size_ = formatSize(size, locale);
  return `${readable} (${extension ? `${extension.toUpperCase()}, ` : ''}${size_})`;
}
