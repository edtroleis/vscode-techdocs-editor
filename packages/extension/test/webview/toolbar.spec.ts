/** A barra do editor visual como ela fica na extensão (o CSS do Crepe carrega depois do nosso). */
import { expect, test } from '@playwright/test';
import { openWebview } from './webview';

const PAGE_KINDS = { group: 'Kinds of page', kinds: [{ id: 'runbook', label: 'Runbook', description: 'Answer an alert' }] };

test('barra numa linha na janela de 790 px; o "+ Insert" com a cor dos ícones e sem texto por cima', async ({ page }) => {
  await page.setViewportSize({ width: 790, height: 600 });
  await openWebview(page, '# Configuração\n', 'en', undefined, { pageKinds: PAGE_KINDS });
  const tops = await page.locator('.top-bar-item').evaluateAll(els => [...new Set(els.map(e => Math.round(e.getBoundingClientRect().top)))]);
  expect(tops, 'a barra quebrou em mais de uma linha').toHaveLength(1);
  const insert = page.locator('.top-bar-item[title="Insert"]');
  const look = await insert.evaluate(button => {
    const label = button.querySelector('.td-insert-label')!;
    const icon = document.querySelector('.top-bar-item[title^="Bold"] svg')!;
    return { text: getComputedStyle(label).color, icon: getComputedStyle(icon).color, fits: button.scrollWidth <= button.clientWidth };
  });
  expect(look.text).toBe(look.icon);
  expect(look.fits, 'o texto passa da largura do botão').toBe(true);
  // O ícone dos tipos de página é só de traço: sem o fundo pintado
  const fill = await page.locator('.top-bar-item[title="Kinds of page"] svg').evaluate(svg => getComputedStyle(svg).fill);
  expect(fill).toBe('none');
});
