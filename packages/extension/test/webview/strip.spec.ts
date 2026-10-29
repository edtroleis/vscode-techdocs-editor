/**
 * Faixa de estado no topo da página (rascunho, enviando, em revisão, o que corrigir): o host manda a faixa
 * pronta; o webview mostra e devolve o botão clicado.
 */
import { expect, test } from '@playwright/test';
import { fromHost, openWebview, sent } from './webview';

const DRAFT = {
  tone: 'draft',
  state: 'Rascunho',
  message: 'Só você vê até enviar.',
  actions: [{ action: 'submit', label: 'Enviar para revisão', primary: true }],
  menu: [
    { action: 'check', label: 'Só verificar' },
    { action: 'details', label: 'Detalhes da publicação' },
  ],
};

const strip = (page: import('@playwright/test').Page) => page.locator('.status-strip');

test('sem faixa até o host mandar; depois o estado, a mensagem e a ação', async ({ page }) => {
  await openWebview(page, '# Página\n');
  await expect(strip(page)).toHaveCount(0);
  await fromHost(page, { type: 'status', strip: DRAFT });
  await expect(strip(page)).toHaveClass(/draft/);
  await expect(strip(page).locator('.status-state')).toHaveText('Rascunho');
  await expect(strip(page).locator('.status-message')).toHaveText('Só você vê até enviar.');
  await strip(page).getByRole('button', { name: 'Enviar para revisão' }).click();
  await expect.poll(async () => (await sent(page)).filter(m => m.type === 'statusAction')).toEqual([{ type: 'statusAction', action: 'submit' }]);
});

test('menu ⋯ com as outras ações', async ({ page }) => {
  await openWebview(page, '# Página\n');
  await fromHost(page, { type: 'status', strip: DRAFT });
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await strip(page).getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Detalhes da publicação' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect.poll(async () => (await sent(page)).filter(m => m.type === 'statusAction').at(-1)).toEqual({ type: 'statusAction', action: 'details' });
});

test('enviando: os passos, sem botões', async ({ page }) => {
  await openWebview(page, '# Página\n');
  await fromHost(page, {
    type: 'status',
    strip: {
      tone: 'draft',
      state: 'Enviando…',
      message: '',
      steps: [
        { label: 'Ajustando a formatação', status: 'done' },
        { label: 'Verificando', status: 'now' },
        { label: 'Pedindo revisão', status: 'todo' },
      ],
      actions: [],
      menu: [],
    },
  });
  await expect(strip(page).locator('.status-step')).toHaveText(['✓ Ajustando a formatação', 'Verificando', '○ Pedindo revisão'].map(t => new RegExp(t.replace('…', '.'))));
  await expect(strip(page).locator('.status-step.now .status-spin')).toHaveCount(1);
  await expect(strip(page).getByRole('button')).toHaveCount(0);
});

test('problema é um alerta; sem faixa, some', async ({ page }) => {
  await openWebview(page, '# Página\n');
  await fromHost(page, { type: 'status', strip: { ...DRAFT, tone: 'problem', state: '1 coisa para corrigir', message: 'Linha 9: link quebrado' } });
  await expect(page.getByRole('alert')).toContainText('Linha 9: link quebrado');
  await fromHost(page, { type: 'status' });
  await expect(strip(page)).toHaveCount(0);
});
