/**
 * Imagem pelo editor visual no VS Code de verdade (spec 01, W9; spec 02, LC3): o botão do bloco de
 * imagem, o arquivo gravado em <docs>/assets/ e o link relativo à página no Markdown.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cursorAtEndOfFirstParagraph, expect, openVisual, save, test, visual } from './vscode';

const PAGE = 'wiki/docs/guias/primeiros-passos.md';

test('"Imagem" no menu /, escolher o arquivo: grava em docs/assets e mostra a imagem', async ({
  vscode: { page, workspace, file },
}) => {
  const png = readFileSync(join(workspace, 'wiki/docs/assets/diagrama.png'));
  await openVisual(page, PAGE);
  await cursorAtEndOfFirstParagraph(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await visual(page).getByRole('listitem').getByText('Image', { exact: true }).click();
  const block = visual(page).locator('.milkdown-image-block');
  await expect(block.getByText('Choose an image from your computer')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await block.locator('label.uploader').click();
  await (await chooser).setFiles({ name: 'Arquitetura Nova.png', mimeType: 'image/png', buffer: png });

  // A imagem aparece, carregada do arquivo gravado (não de um blob: do navegador)
  const img = block.locator('img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(40);
  // A tecla Enter já deixa a aba alterada; o link chega um pouco depois (o editor avisa com atraso)
  await expect
    .poll(async () => {
      await save(page);
      return file(PAGE);
    })
    .toMatch(/\n!\[Arquitetura Nova\]\(\.\.\/assets\/\d+-arquitetura-nova\.png\)\n/);
  const text = file(PAGE);
  const [, name] = /\.\.\/assets\/(\d+-arquitetura-nova\.png)/.exec(text)!;
  const saved = join(workspace, 'wiki/docs/assets', name);
  expect(existsSync(saved)).toBe(true);
  expect(readFileSync(saved).equals(png)).toBe(true);
  expect(text).not.toContain('blob:');
});
