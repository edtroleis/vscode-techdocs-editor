/**
 * Cenário 10: uma pessoa que trabalha só com o teclado, no tema claro. Ela chega à árvore pela paleta, abre uma
 * página com Enter, escreve com os atalhos do Markdown e do editor (títulos, listas, negrito, código), busca, desfaz,
 * salva e tenta sair do editor visual pelos atalhos do VS Code. O cenário também mede o contraste dos botões da barra.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameLocator, Page } from '@playwright/test';
import { expect, folderFrom, pause, test, toEnd, type } from './story';
import { docsPane, editorOf, quickInput, techdocsIcon, treeRow } from './ui';

const folder = folderFrom('manual-loja', 'manual-loja');
const read = (path: string) => readFileSync(join(folder, path), 'utf8');

/** Contraste WCAG entre duas cores `rgb(...)`. */
function contrast(a: string, b: string) {
  const lum = (rgb: string) => {
    const [r, g, bl] = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** O elemento com o foco: na janela do VS Code ou dentro do editor visual. */
const focusIn = (page: Page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}` : '';
});

test.use({
  folder,
  theme: 'Default Light Modern',
  scenario: {
    id: '10-so-teclado',
    title: 'Só teclado, tema claro: abrir, escrever, buscar, desfazer e sair do editor',
    summary:
      'Uma pessoa que não usa o mouse, com o VS Code no tema claro. Chega à árvore pela paleta, abre uma página com Enter, escreve com os atalhos do Markdown (##, -, **, `), busca com Ctrl+F, desfaz e refaz, salva e tenta voltar à barra lateral pelos atalhos do VS Code. Mede também o contraste dos botões da barra no tema claro.',
  },
});

test('só teclado, tema claro: abrir, escrever, buscar, desfazer e sair do editor', async ({ vscode: { page }, story }) => {
  let editor!: FrameLocator;

  await story.step('Pela paleta, ir para a árvore da documentação', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('F1');
    await expect(quickInput(page).locator('input')).toBeFocused();
    await type(page, 'Focus on Documentation View');
    const row = quickInput(page).locator('.monaco-list-row', { hasText: 'Focus on Documentation View' }).first();
    await story.check('o comando "Focus on Documentation View" na paleta', () => expect(row).toBeVisible());
    await page.keyboard.press('Enter');
    await expect(docsPane(page).locator('.monaco-list')).toBeFocused({ timeout: 10_000 });
    await pause(page);
  });

  await story.step('Setas até "Guias", → abre a seção, ↓ até "Instalar" e Enter: a página abre no editor visual', async () => {
    // A primeira linha é o site; desce até Guias
    for (let i = 0; i < 8; i++) {
      const focused = docsPane(page).locator('.monaco-list-row.focused .label-name');
      if ((await focused.textContent().catch(() => '')) === 'Guias') break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(docsPane(page).locator('.monaco-list-row.focused .label-name')).toHaveText('Guias');
    if ((await treeRow(page, 'Guias').getAttribute('aria-expanded')) === 'false') await page.keyboard.press('ArrowRight');
    // As páginas da seção chegam um instante depois de abrir
    await expect(treeRow(page, 'Instalar')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(docsPane(page).locator('.monaco-list-row.focused .label-name')).toHaveText('Instalar');
    await page.keyboard.press('Enter');
    const opened = () => page.locator('.tab.active', { hasText: 'instalar.md' }).waitFor({ timeout: 5_000 }).then(() => true, () => false);
    if (!(await opened())) {
      story.bug('Enter na página focada da árvore ("Instalar", alcançada pelas setas) não abre a página: nada acontece.');
      await page.keyboard.press('Space');
      if (await opened()) story.ok('Espaço na mesma linha abre a página.');
      else await treeRow(page, 'Instalar').click();
    }
    editor = await editorOf(page);
    await expect(editor.locator('.ProseMirror h1')).toHaveText('Instalar');
    await page.waitForTimeout(800);
    // Digitar logo depois de abrir: a letra aparece na página?
    const typesHere = async () => {
      await page.keyboard.type('Z');
      const ok = await editor.locator('.ProseMirror').getByText(/Z/).count().then(n => n > 0);
      if (ok) await page.keyboard.press('Backspace');
      return ok;
    };
    if (!(await typesHere())) {
      const lost = `Depois de abrir a página pela árvore com o teclado, o que se digita se perde: o foco fica em "${await focusIn(page)}" e não no texto da página.`;
      // A janela do VS Code de teste nunca tem o foco do sistema; assim, às vezes (~1 em 2) o VS Code não passa o foco
      // ao webview que ainda está carregando: nenhum evento de foco chega a ele. Com a janela focada (o uso real), é
      // bug; sem ela, é do ambiente. Levar o foco à página depois que ela fica pronta roubava o foco de quem já tinha
      // ido para a paleta
      if (await page.evaluate(() => document.hasFocus())) story.bug(lost);
      else story.suggest(`${lost} (janela de teste sem o foco do sistema: conferir à mão no VS Code)`);
      await page.keyboard.press('Control+1');
      await page.waitForTimeout(500);
      if (await typesHere()) story.ok('Ctrl+1 (ir para o editor) põe o cursor no texto.');
      else {
        story.bug('Nem Ctrl+1 põe o cursor no texto do editor visual: só clicando na página.');
        await editor.locator('.ProseMirror p').last().click();
      }
    }
    await pause(page);
  });

  await story.step('Escrever só com atalhos: ## título, lista com -, negrito com Ctrl+B, código com `', async () => {
    await toEnd(page);
    await page.keyboard.press('Enter');
    await type(page, '## Requisitos\n');
    await type(page, '- Docker\nGit\n\n');
    await page.keyboard.press('Control+B');
    await type(page, 'Importante');
    await page.keyboard.press('Control+B');
    await type(page, ': rode ');
    await type(page, '`make setup`');
    await type(page, ' antes.');
    await story.check('## virou título', () => expect(editor.locator('.ProseMirror h2', { hasText: 'Requisitos' })).toBeVisible());
    await story.check('- virou lista com dois itens', () => expect(editor.locator('.ProseMirror ul li')).toHaveCount(2));
    await story.check('Ctrl+B pôs em negrito', () => expect(editor.locator('.ProseMirror strong', { hasText: 'Importante' })).toBeVisible());
    await story.check('crases viraram código', () => expect(editor.locator('.ProseMirror code', { hasText: 'make setup' })).toBeVisible());
    await pause(page);
  });

  await story.step('Ctrl+F: buscar "Docker" na página; Esc fecha', async () => {
    await page.keyboard.press('Control+F');
    const bar = editor.locator('.docs-search-bar');
    await story.check('a busca do editor visual abre com o foco', () => expect(bar.locator('input')).toBeFocused());
    await type(page, 'Docker');
    await story.check('a busca conta 1 resultado', () => expect(bar.locator('.docs-search-count')).toHaveText(/1 of 1/));
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await pause(page);
  });

  await story.step('Ctrl+Z desfaz a última frase, Ctrl+Y refaz', async () => {
    await toEnd(page);
    await page.keyboard.press('Control+Z');
    const after = await editor.locator('.ProseMirror').innerText();
    story.ok(`Depois de um Ctrl+Z, o fim da página é: "${after.trim().split('\n').pop()}"`);
    await page.keyboard.press('Control+Y');
    await story.check('Ctrl+Y traz o texto de volta', () => expect(editor.locator('.ProseMirror')).toContainText('antes.'));
    await pause(page);
  });

  await story.step('Ctrl+S grava o Markdown esperado', async () => {
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tab.active.dirty')).toHaveCount(0);
    const text = read('docs/guias/instalar.md');
    await story.check('o arquivo tem o título, a lista, o negrito e o código', async () => {
      expect(text).toContain('## Requisitos');
      expect(text).toMatch(/- Docker\n- Git/);
      expect(text).toContain('**Importante**: rode `make setup` antes.');
    });
    await pause(page);
  });

  await story.step('Sair do editor visual pelo teclado: Ctrl+Shift+E (Explorer) e Ctrl+0 (barra lateral)', async () => {
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(800);
    const explorer = await page.locator('.explorer-folders-view').isVisible();
    if (!explorer) story.suggest('Com o foco no editor visual, Ctrl+Shift+E não abre o Explorer (o webview fica com a tecla). Quem usa só o teclado fica preso no editor.');
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(800);
    const where = await focusIn(page);
    if (/iframe/.test(where)) story.suggest('Com o foco no editor visual, Ctrl+0 (ir para a barra lateral) não tira o foco do editor.');
    else story.ok(`Ctrl+0 levou o foco para "${where}".`);
    await pause(page);
  });

  await story.step('Tema claro: o contraste dos botões da barra do editor visual', async () => {
    editor = await editorOf(page);
    const colors = await editor.locator('.top-bar-item svg').evaluateAll(svgs =>
      svgs.map(svg => {
        const style = getComputedStyle(svg);
        let bg = 'rgba(0, 0, 0, 0)';
        for (let el: Element | null = svg; el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg); el = el.parentElement) bg = getComputedStyle(el).backgroundColor;
        if (/rgba\(0, 0, 0, 0\)/.test(bg)) bg = getComputedStyle(document.body).backgroundColor;
        return { fill: style.fill !== 'none' ? style.fill : style.color, bg };
      }),
    );
    const ratios = colors.map(c => contrast(c.fill, c.bg));
    const worst = Math.min(...ratios);
    story.ok(`Contraste dos ${ratios.length} botões da barra no tema claro: o menor é ${worst.toFixed(1)}:1.`);
    await story.check('os ícones da barra com contraste de pelo menos 3:1 (WCAG para ícones)', async () => expect(worst).toBeGreaterThanOrEqual(3));
  });
});
