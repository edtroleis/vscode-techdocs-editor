/**
 * Menor trecho a trocar para ir de `before` a `after`: tudo menos o prefixo e o sufixo comuns.
 * Trocar o documento inteiro a cada tecla poluiria o desfazer do VS Code e o diff do Git, e moveria
 * marcadores e o cursor de quem está com o arquivo aberto no editor de texto ao lado.
 */
export function minimalEdit(before: string, after: string): { start: number; end: number; text: string } {
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let tail = 0;
  while (
    tail < shortest - start &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail++;
  }
  return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}

/** O editor trabalha com `\n`; o arquivo pode estar com `\r\n` (Windows) e assim deve continuar. */
export const toLf = (text: string) => text.replace(/\r\n/g, '\n');
export const toEol = (text: string, eol: '\n' | '\r\n') => (eol === '\n' ? text : text.replace(/\n/g, '\r\n'));
