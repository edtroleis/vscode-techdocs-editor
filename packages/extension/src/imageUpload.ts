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
