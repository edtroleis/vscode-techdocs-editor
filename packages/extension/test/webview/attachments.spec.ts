/**
 * + Inserir › Arquivo… e "/anexo" (o harness roda em português) (spec 07, revisada na 0.22): o seletor de arquivos, os bytes ao host e, no cursor,
 * o link do anexo (ou a imagem) que o host devolve.
 */
import { expect, Page, test } from '@playwright/test';
import { fromHost, lastEdit, openWebview, sent } from './webview';

const PAGE = '# Contrato\n\nO contrato está aqui:\n';

type Attach = { type: 'attachFile'; id: number; name: string; data: Record<string, number> };

/** Cursor no fim do parágrafo; `open` abre o seletor (pela barra ou pelo "/"); escolhe o arquivo. */
async function attach(page: Page, open: () => Promise<void>, name = 'Manual do Cliente.pdf') {
  await page.locator('.milkdown .ProseMirror p').last().click();
  await page.keyboard.press('End');
  const chooser = page.waitForEvent('filechooser');
  await open();
  await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) });
  await expect.poll(async () => (await sent(page)).some(m => m.type === 'attachFile')).toBe(true);
  return (await sent(page)).filter(m => m.type === 'attachFile').at(-1) as unknown as Attach;
}

const byInsertMenu = (page: Page) => async () => {
  await page.locator('.top-bar-item[title="Inserir"]').click();
  await page.getByRole('menuitem', { name: 'Arquivo…' }).click();
};

test('+ Inserir › Arquivo…: manda nome e bytes; o link com nome, tipo e tamanho entra no cursor, com o clipe', async ({ page }) => {
  await openWebview(page, PAGE);
  // Logo depois de Image, no menu
  await page.locator('.top-bar-item[title="Inserir"]').click();
  const items = await page.locator('.td-top-menu [role^="menuitem"]').allTextContents();
  expect(items.slice(0, 2).map(t => t.trim())).toEqual(['Imagem', 'Arquivo…']);
  await page.keyboard.press('Escape');

  const message = await attach(page, byInsertMenu(page));
  expect(message.name).toBe('Manual do Cliente.pdf');
  expect(Object.values(message.data)).toEqual([1, 2, 3]);
  await fromHost(page, { type: 'attached', id: message.id, kind: 'file', link: 'assets/manual-do-cliente.pdf', text: 'Manual do Cliente (PDF, 2,3 MB)' });
  await expect.poll(() => lastEdit(page)).toContain('O contrato está aqui: [Manual do Cliente (PDF, 2,3 MB)](assets/manual-do-cliente.pdf)');
  const link = page.locator('.milkdown .ProseMirror a[href="assets/manual-do-cliente.pdf"]');
  expect(await link.evaluate(a => getComputedStyle(a, '::before').content)).toContain('📎');
});

test('imagem escolhida em Arquivo…: entra como imagem', async ({ page }) => {
  await openWebview(page, PAGE);
  const message = await attach(page, byInsertMenu(page), 'Diagrama.png');
  await fromHost(page, { type: 'attached', id: message.id, kind: 'image', link: 'images/diagrama.png', text: 'Diagrama' });
  await expect.poll(() => lastEdit(page)).toContain('![Diagrama](images/diagrama.png)');
});

test('recusado pelo host: nada entra na página', async ({ page }) => {
  await openWebview(page, PAGE);
  const message = await attach(page, byInsertMenu(page), 'setup.exe');
  await fromHost(page, { type: 'attached', id: message.id, error: '.exe files are not accepted: setup.exe' });
  await page.waitForTimeout(300);
  expect((await lastEdit(page)) ?? '').not.toContain('setup');
});

test('"/anexo" acha o item e abre o seletor; colchetes no nome não quebram o link', async ({ page }) => {
  await openWebview(page, PAGE);
  const message = await attach(page, async () => {
    await page.keyboard.press('Enter');
    await page.keyboard.type('/anexo');
    await page.locator('.milkdown-slash-menu').getByText('Arquivo (anexo)').click();
  }, 'Plano [v2].xlsx');
  await fromHost(page, { type: 'attached', id: message.id, kind: 'file', link: 'assets/plano-v2.xlsx', text: 'Plano [v2] (XLSX, 3 B)' });
  await expect.poll(() => lastEdit(page)).toContain('[Plano \\[v2\\] (XLSX, 3 B)](assets/plano-v2.xlsx)');
  expect(await lastEdit(page)).not.toContain('/anexo');
});

test('o texto do link é editável: trocar o nome inteiro ou apagar uma letra mantém o link; o clipe fica fora do sublinhado', async ({ page }) => {
  await openWebview(page, PAGE);
  const message = await attach(page, byInsertMenu(page));
  await fromHost(page, { type: 'attached', id: message.id, kind: 'file', link: 'assets/manual-do-cliente.pdf', text: 'Manual do Cliente (PDF, 2,3 MB)' });
  const link = page.locator('.milkdown .ProseMirror a[href="assets/manual-do-cliente.pdf"]');
  await expect(link).toHaveCount(1);
  const before = await link.evaluate(a => getComputedStyle(a, '::before'));
  expect(before.display).toBe('inline-block');
  // Trocar o nome inteiro
  await link.selectText();
  await page.keyboard.type('Contrato assinado');
  await expect.poll(() => lastEdit(page)).toContain('[Contrato assinado](assets/manual-do-cliente.pdf)');
  // Apagar uma letra
  await page.keyboard.press('Backspace');
  await expect.poll(() => lastEdit(page)).toContain('[Contrato assinad](assets/manual-do-cliente.pdf)');
});
