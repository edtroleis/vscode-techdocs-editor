import { merge3, resolveChunks } from '@edtroleis/techdocs-editor-core';

/**
 * Aplica ao texto do documento (`document`) só o que a pessoa mudou no editor visual (de `before`
 * para `after`, os dois no formato do repositório). O documento pode ter mudado por fora (texto ao
 * lado) ou não estar no formato que o editor gera (o editor normaliza ao carregar): trocar o arquivo
 * inteiro pelo `after` desfaria essas mudanças, ou reformataria trechos que ninguém tocou.
 * Num conflito (os dois mexeram nas mesmas linhas) vale o que a pessoa acabou de fazer no visual.
 */
export function rebase(before: string, after: string, document: string): string {
  if (before === after) return document;
  if (before === document) return after;
  const chunks = merge3(before, after, document);
  return resolveChunks(
    chunks,
    chunks.filter(chunk => chunk.kind === 'conflict').map(() => 'mine'),
  );
}
