/**
 * Imagens de fora (spec 05, C3): baixar a imagem colada de outra ferramenta. Gravar fica com attachments.ts.
 */

/** Só endereços da web: o painel abre fora do VS Code só o que é http(s) (nada de command:, file: e afins). */
export function isWebUrl(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

const safeDecode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** O corpo da resposta, parando de ler (e falhando) quando passa do limite: o servidor pode não dizer o tamanho. */
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel();
      throw new Error('tooLarge');
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.byteLength;
  }
  return data;
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
  // Endereço privado costuma responder a página de login (HTML) com 200: não é imagem, mesmo com .png no nome
  if (!mime.startsWith('image/')) throw new Error('notAnImage');
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxMB * 1024 * 1024) throw new Error('tooLarge');
  const data = await readLimited(response, maxMB * 1024 * 1024);
  let name = safeDecode(parsed.pathname.split('/').pop() ?? '') || 'imagem';
  if (!/\.[a-z0-9]{2,5}$/i.test(name) && EXTENSIONS[mime]) name = `${name}.${EXTENSIONS[mime]}`;
  return { name, mime, data };
}
