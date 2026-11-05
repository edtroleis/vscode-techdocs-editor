/** O que as gravações do README dividem: onde os vídeos ficam, o tamanho da janela e onde cada um começa. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const OUT = join(__dirname, '../../../../node_modules/.cache/editor-videos');
export const SIZE = { width: 1280, height: 800 };

/** Marca onde o vídeo começa a interessar (depois da abertura do VS Code). */
export function markStart(name: string, startedAt: number) {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, 'starts.json');
  let starts: Record<string, number> = {};
  try {
    starts = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // primeiro vídeo
  }
  starts[name] = (Date.now() - startedAt) / 1000;
  writeFileSync(path, JSON.stringify(starts, null, 2));
}

/** Uma cópia nova do site de exemplo em inglês (fixtures/payments), num diretório `payments-service`. */
export function paymentsSite(): string {
  const folder = join(mkdtempSync(join(tmpdir(), 'techdocs-video-')), 'payments-service');
  cpSync(join(__dirname, 'fixtures/payments'), folder, { recursive: true });
  return folder;
}
