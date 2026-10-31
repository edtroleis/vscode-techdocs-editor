import { dirOf, relativePath, resolvePath } from './mkdocs';

/** Imagens: ao trazer um Markdown de fora do `docs_dir`, as de fora dele viram cópias dentro (o site só publica o `docs_dir`). */
const IMAGE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
const isUrl = (path: string) => /^[a-z][a-z0-9+.-]*:/i.test(path);

export type BroughtPage = {
  text: string;
  /** Imagens de fora do `docs_dir` a copiar para `assets/` dele: de → para, caminhos no repositório. */
  images: Array<{ from: string; to: string }>;
  /** Links para fora do `docs_dir` sem endereço do repositório que viraram texto (`texto (\`caminho\`)`). */
  asText: string[];
  /** Definições de referência (`[id]: caminho`) para fora sem endereço: ficaram relativas e quebram o site. */
  left: string[];
};

/**
 * Um Markdown de fora do `docs_dir` (o README, quase sempre) como página em `to`, com os links acertados (todos os
 * caminhos são do repositório): para dentro do `docs_dir`, relativos à página nova; imagem de fora, a cópia em
 * `<docs_dir>/assets/` (`taken`: os arquivos que já existem lá, para não sobrescrever); outro arquivo de fora (código,
 * `CONTRIBUTING.md`), o endereço dele no repositório (`fileUrl`); sem ele, o link vira texto com o caminho, porque o
 * `mkdocs build --strict` do TechDocs aborta com link para fora do `docs_dir` (definição de referência: em `left`).
 */
export function bringIntoDocs(
  markdown: string,
  { from, to, docsDir, fileUrl, taken = new Set() }: { from: string; to: string; docsDir: string; fileUrl?: (path: string) => string; taken?: ReadonlySet<string> },
): BroughtPage {
  const images = new Map<string, string>();
  const used = new Set(taken);
  const left = new Set<string>();
  const asText = new Set<string>();
  const inDocs = (path: string) => path.startsWith(`${docsDir}/`);
  const copyOf = (path: string) => {
    const known = images.get(path);
    if (known) return known;
    const name = path.split('/').pop()!;
    const dot = name.lastIndexOf('.');
    let target = `${docsDir}/assets/${name}`;
    for (let n = 2; used.has(target); n++) target = `${docsDir}/assets/${name.slice(0, dot)}-${n}${name.slice(dot)}`;
    used.add(target);
    images.set(path, target);
    return target;
  };
  /** O caminho no repositório do link (sem `#…`/`?…`); undefined para endereço, âncora ou caminho absoluto. */
  const parse = (raw: string) => {
    const wrapped = raw.startsWith('<') && raw.endsWith('>');
    const inner = wrapped ? raw.slice(1, -1) : raw;
    const cut = inner.search(/[#?]/);
    const target = cut < 0 ? inner : inner.slice(0, cut);
    const suffix = cut < 0 ? '' : inner.slice(cut);
    if (!target || isUrl(target) || target.startsWith('/')) return undefined;
    let decoded = target;
    try {
      decoded = decodeURI(target);
    } catch {
      // Endereço com % solto: fica como está
    }
    return { wrapped, suffix, resolved: resolvePath(dirOf(from), decoded) };
  };
  const fix = (raw: string): string => {
    const parsed = parse(raw);
    if (!parsed) return raw;
    const { wrapped, suffix, resolved } = parsed;
    let link: string;
    if (inDocs(resolved)) link = relativePath(dirOf(to), resolved);
    else if (IMAGE.test(resolved)) link = relativePath(dirOf(to), copyOf(resolved));
    else if (fileUrl) return `${fileUrl(resolved)}${suffix}`;
    else {
      left.add(resolved);
      link = relativePath(dirOf(to), resolved);
    }
    // Espaço no caminho quebraria o link do Markdown (dentro de `<…>` pode ficar)
    const text = `${wrapped ? link : link.replace(/ /g, '%20')}${suffix}`;
    return wrapped ? `<${text}>` : text;
  };
  // Sem endereço do repositório: o link (não imagem) para um arquivo de fora vira o texto dele com o caminho
  const outside = (raw: string) => {
    const parsed = parse(raw);
    return parsed && !inDocs(parsed.resolved) && !IMAGE.test(parsed.resolved) ? parsed.resolved : undefined;
  };
  const textual = fileUrl
    ? markdown
    : markdown.replace(/(^|[^!])\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, (link: string, before: string, label: string, url: string) => {
        const path = outside(url);
        if (!path) return link;
        asText.add(path);
        // O caminho como o arquivo de origem escreve (a partir da pasta dele), sem `./`
        const shown = relativePath(dirOf(from), path);
        return `${before}${label ? `${label} (\`${shown}\`)` : `\`${shown}\``}`;
      });
  const text = textual
    .replace(/(\]\(\s*)(<[^>]*>|[^)\s]+)/g, (_, before: string, url: string) => before + fix(url))
    .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/gm, (_, before: string, url: string) => before + fix(url))
    .replace(/(<img\b[^>]*\bsrc=["'])([^"']+)/gi, (_, before: string, url: string) => before + fix(url));
  return { text, images: [...images].map(([path, target]) => ({ from: path, to: target })), asText: [...asText], left: [...left] };
}

/**
 * O endereço de um arquivo do repositório no GitHub, na branch principal: `repo_url` do `mkdocs.yml` (ou a URL do
 * `origin`, já como `https://host/dono/repo`) + `/blob/<branch>/<caminho>`.
 */
export function repoFileUrl(repoUrl: string, branch: string, path: string): string {
  return `${repoUrl.replace(/\/+$/, '').replace(/\.git$/, '')}/blob/${branch}/${encodeURI(path)}`;
}

/** O `repo_url` do `mkdocs.yml` (endereço http do repositório), se tiver. */
export function mkdocsRepoUrl(yml: string | undefined): string | undefined {
  const value = yml?.match(/^repo_url:\s*['"]?([^'"\s#]+)/m)?.[1];
  return value && /^https?:\/\//.test(value) ? value : undefined;
}
