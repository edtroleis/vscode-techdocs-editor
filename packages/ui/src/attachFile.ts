import { editorViewCtx } from '@milkdown/kit/core';
import { createSlice, type Ctx } from '@milkdown/kit/ctx';
import { insert } from '@milkdown/kit/utils';
import { icon } from './icons';

/**
 * "+ Inserir › Arquivo…" e "/arquivo" (spec 07, revisada na 0.22): o seletor de arquivos do sistema; quem usa o
 * editor grava cada arquivo escolhido e devolve o Markdown que entra no cursor (link do anexo, ou a imagem).
 * Sem quem grave (undefined), o item não aparece.
 */
export type AttachFile = (file: File) => Promise<string | undefined>;

export const attachFileCtx = createSlice<AttachFile | null>(null, 'docsEditorAttachFile');

/** Clipe de papel. */
export const FILE_ICON = icon(
  'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z',
);

/** Abre o seletor; cada arquivo escolhido entra no cursor, na ordem, separado do texto por um espaço. */
export function pickFile(ctx: Ctx) {
  const attach = ctx.get(attachFileCtx);
  if (!attach) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.addEventListener(
    'change',
    async () => {
      for (const file of [...(input.files ?? [])]) {
        const markdown = await attach(file).catch(() => undefined);
        if (!markdown) continue;
        // Colado no texto ("aqui:" + link) não: um espaço antes, quando o cursor está logo depois de uma letra
        const view = ctx.get(editorViewCtx);
        const before = view.state.selection.$from.nodeBefore;
        // O parser do Markdown descarta o espaço do começo: vai direto no texto
        if (before?.isText && !/\s$/.test(before.text ?? '')) view.dispatch(view.state.tr.insertText(' '));
        insert(markdown, true)(ctx);
      }
      ctx.get(editorViewCtx).focus();
    },
    { once: true },
  );
  input.click();
}
