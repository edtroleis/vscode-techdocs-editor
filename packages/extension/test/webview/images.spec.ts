/**
 * Envio de imagens pelo editor visual (spec 01, W9): o webview manda os bytes ao host e põe no
 * Markdown o link que o host devolve, nunca `blob:`.
 */
import { expect, Page, test } from '@playwright/test';
import { fromHost, lastEdit, openWebview, savedText, sent } from './webview';

const PAGE = '# Página\n\nTexto.\n';

type Upload = { type: 'uploadImage'; id: number; name: string; mime: string; data: Record<string, number> };

/** Bloco de imagem vazio no fim da página, com o arquivo escolhido no botão de envio. */
async function chooseImage(page: Page, name = 'Captura.png', mime = 'image/png') {
  await page.locator('.milkdown .ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.evaluate(m => window.postMessage(m, '*'), { type: 'test:insert', markdown: '\n\n![]()\n' });
  await expect(page.locator('.milkdown-image-block input[type="file"]')).toHaveCount(1);
  await page.locator('.milkdown-image-block input[type="file"]').setInputFiles({
    name,
    mimeType: mime,
    buffer: Buffer.from([1, 2, 3]),
  });
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'uploadImage')).toBe(true);
  return (await sent(page)).find(m => m.type === 'uploadImage') as unknown as Upload;
}

test('manda nome, tipo e bytes; o link devolvido vai para o Markdown, com o nome como texto alternativo', async ({ page }) => {
  await openWebview(page, PAGE);
  const upload = await chooseImage(page);
  expect(upload).toMatchObject({ name: 'Captura.png', mime: 'image/png' });
  expect(Object.values(upload.data)).toEqual([1, 2, 3]);

  await fromHost(page, { type: 'uploaded', id: upload.id, link: 'assets/1-captura.png' });
  await expect.poll(() => lastEdit(page)).toContain('![Captura](assets/1-captura.png)');
  expect(await lastEdit(page)).not.toContain('blob:');
  // A imagem aparece pelo endereço do webview, a partir da pasta da página
  await expect(page.locator('.milkdown-image-block img')).toHaveAttribute('src', 'file:///wiki/docs/assets/1-captura.png');
});

test('recusada pelo host: nada vai para o Markdown', async ({ page }) => {
  const { errors } = await openWebview(page, PAGE);
  const upload = await chooseImage(page, 'notas.pdf', 'application/pdf');
  await fromHost(page, { type: 'uploaded', id: upload.id, error: '"notas.pdf" is not an image' });
  await page.waitForTimeout(300);
  expect((await lastEdit(page)) ?? '').not.toMatch(/notas|blob:/);
  expect(errors.filter(e => !/not an image/.test(e))).toEqual([]);
});

test('texto alternativo da imagem fica como estava; sem ele, a legenda', async ({ page }) => {
  await openWebview(page, '# P\n\n![Diagrama](a.png)\n\n![](b.png "Fluxo do pedido")\n\n![](c.png)\n');
  await expect.poll(() => savedText(page)).toBe(
    '# P\n\n![Diagrama](a.png)\n\n![Fluxo do pedido](b.png "Fluxo do pedido")\n\n![](c.png)\n',
  );
});
