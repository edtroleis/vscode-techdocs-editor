/**
 * Imagens enviadas pelo editor visual (spec 01, W9; spec 02, LC3): vão para `<docs>/assets/` com o
 * horário na frente do nome, como no plugin, e o Markdown leva o caminho relativo à página.
 */
import { relativePath } from '@edtroleis/techdocs-editor-core';

/** Limite padrão de `techdocsEditor.images.maxSizeMB` (o mesmo `images.maxSizeMB` do plugin). */
export const DEFAULT_MAX_IMAGE_MB = 5;

/** Por que a imagem foi recusada, ou undefined se ela pode ser gravada. */
export function imageProblem(mime: string, size: number, maxMB: number): 'notAnImage' | 'tooLarge' | undefined {
  if (!mime.startsWith('image/')) return 'notAnImage';
  // A imagem vai para o repositório: arquivos enormes pesam em todo clone e na publicação
  if (size > maxMB * 1024 * 1024) return 'tooLarge';
  return undefined;
}

/** Nome seguro para URL e para qualquer sistema de arquivos (como no plugin). */
export const imageFileName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

/**
 * Onde gravar a imagem e o link para a página. `docsDir` é o `docs_dir` do site da página; página fora
 * de um site grava em `assets/` ao lado dela. Caminhos absolutos, com `/`.
 */
export function imageTarget(pagePath: string, docsDir: string | undefined, name: string, now: number) {
  const pageDir = pagePath.split('/').slice(0, -1).join('/');
  const path = `${docsDir ?? pageDir}/assets/${now}-${imageFileName(name)}`;
  return { path, link: relativePath(pageDir, path) };
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/**
 * Baixa a imagem colada de outra ferramenta (spec 05, C3): só http(s), com limite de tempo e de tamanho. O nome é o
 * do arquivo no endereço (com a extensão do tipo, se não tiver). Endereço que pede login responde com a página de
 * entrada (HTML): recusado como "não é uma imagem".
 */
export async function downloadImage(url: string, maxMB: number, get: typeof fetch = fetch): Promise<{ name: string; mime: string; data: Uint8Array }> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('not http');
  const response = await get(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxMB * 1024 * 1024) throw new Error('tooLarge');
  const data = new Uint8Array(await response.arrayBuffer());
  let name = decodeURIComponent(parsed.pathname.split('/').pop() ?? '') || 'imagem';
  if (!/\.[a-z0-9]{2,5}$/i.test(name) && EXTENSIONS[mime]) name = `${name}.${EXTENSIONS[mime]}`;
  return { name, mime, data };
}
