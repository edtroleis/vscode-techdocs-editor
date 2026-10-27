import { expect, Locator, Page } from '@playwright/test';

// Copiados do plugin (e2e/tests/helpers.ts): mesmas interações com o editor nos dois lugares.

export const editor = (page: Page) => page.locator('.milkdown .ProseMirror');

/** Coloca o cursor no fim do documento, numa linha nova vazia. */
export async function newLineAtEnd(page: Page) {
  await cursorToEnd(page, editor(page).locator('> p, > h1, > h2, > h3, > ul, > ol, > blockquote').last());
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
}

/** Digita "/" e escolhe um item do menu de blocos. */
export async function slash(page: Page, label: string) {
  await page.keyboard.type('/');
  await page.locator(`.milkdown-slash-menu li:has(span:text-is("${label}"))`).click();
  // Só depois de o menu fechar o bloco novo está pronto para receber texto
  await expect(page.locator('.milkdown-slash-menu')).toBeHidden();
}

/** Clica no bloco e põe o cursor no fim dele, esperando o editor posicionar o cursor. */
export async function cursorToEnd(page: Page, block: Locator) {
  await block.click();
  await expect
    .poll(async () => {
      await page.keyboard.press('End');
      const { atEnd, lineBelow } = await block.evaluate(element => {
        const selection = window.getSelection();
        if (!selection?.focusNode || !element.contains(selection.focusNode)) return { atEnd: false, lineBelow: false };
        const rest = document.createRange();
        rest.setStart(selection.focusNode, selection.focusOffset);
        rest.setEndAfter(element.lastChild ?? element);
        const caret = selection.getRangeAt(0).getClientRects()[0];
        const lastLine = [...rest.getClientRects()].at(-1);
        return {
          atEnd: rest.toString() === '',
          // Ainda há texto do bloco numa linha abaixo do cursor (parágrafo que quebra na tela)
          lineBelow: Boolean(caret && lastLine && lastLine.top > caret.bottom - 2),
        };
      });
      // End vai só até o fim da linha na tela: num parágrafo que quebra em várias, desce uma linha
      if (lineBelow) await page.keyboard.press('ArrowDown');
      return atEnd;
    }, { message: 'cursor no fim do bloco' })
    .toBe(true);
}
