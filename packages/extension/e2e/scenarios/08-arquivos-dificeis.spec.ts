/**
 * Cenário 8: a Plataforma de Dados, um site que usa o que o MkDocs tem de mais avançado (front matter, avisos,
 * abas, notas de rodapé, atributos, HTML, abreviações), uma página com CRLF e um catálogo com 400 tabelas. A pessoa
 * edita uma palavra em cada página e confere que o resto do arquivo não muda; alguém muda um arquivo por fora (um
 * git pull) com a página aberta; o mkdocs.yml quebra e volta.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameLocator, Page } from '@playwright/test';
import { click, expect, folderFrom, pause, test, toEnd, type } from './story';
import { buildSite, editorOf, openFromTree, palette, save, techdocsIcon, treeRow } from './ui';

const folder = folderFrom('site-avancado', 'dados');
const read = (path: string) => readFileSync(join(folder, path), 'utf8');
const original = (path: string) => readFileSync(join(__dirname, 'fixtures/site-avancado', path), 'utf8');

/** As linhas que mudaram entre o original e o atual (sem contar a ordem). */
function changedLines(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  return { removed: a.filter(l => !b.includes(l)), added: b.filter(l => !a.includes(l)) };
}

/** Acrescenta texto ao fim do primeiro parágrafo que tem `anchor`. */
async function appendTo(page: Page, editor: FrameLocator, anchor: string, text: string) {
  const paragraph = editor.locator('.ProseMirror p', { hasText: anchor }).first();
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.click();
  await page.keyboard.press('End');
  await type(page, text);
}

test.use({
  folder,
  scenario: {
    id: '08-arquivos-dificeis',
    title: 'Arquivos difíceis: recursos do MkDocs, CRLF, página grande e mudanças por fora',
    summary:
      'A Plataforma de Dados usa front matter, avisos, abas, notas de rodapé, atributos, HTML e abreviações; tem uma página com CRLF e um catálogo de 3.600 linhas. A pessoa muda uma palavra em cada página e confere que só aquilo mudou no arquivo; um git pull muda a página aberta; o mkdocs.yml quebra e volta.',
  },
});

test('arquivos difíceis: recursos do mkdocs, crlf, página grande e mudanças por fora', async ({ vscode: { page }, story }) => {
  await story.step('Abrir "Recursos" (avisos, abas, notas, HTML) no editor visual: a página não fica alterada', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    const editor = await openFromTree(page, 'Recursos');
    await page.waitForTimeout(1_500);
    await story.check('abrir não deixa a aba alterada', () => expect(page.locator('.tab.active.dirty')).toHaveCount(0));
    // O que a pessoa vê: os avisos e as abas não são texto cru
    const text = await editor.locator('.ProseMirror').innerText();
    if (/^!!! note/m.test(text) || /^=== "Python"/m.test(text)) {
      story.suggest('Os avisos (!!! note) e as abas (=== "Python") do MkDocs aparecem como texto cru no editor visual, com o recuo de 4 espaços que a pessoa não pode perder.');
    }
    // O front matter fica num bloco protegido no topo (texto cru), não vira linha horizontal + parágrafo
    await story.check('o front matter fica num bloco protegido no topo', async () => {
      await expect(editor.locator('.ProseMirror > hr')).toHaveCount(0);
      await expect(editor.locator('.milkdown-code-block').first()).toContainText('title: Recursos');
    });
    await pause(page, 1_500);
  });

  await story.step('Mudar uma frase em "Recursos" e salvar: só aquela linha muda no arquivo', async () => {
    const editor = await editorOf(page);
    await appendTo(page, editor, 'O ETL roda de hora em hora', ' Fora disso, só sob demanda.');
    await save(page);
    const diff = changedLines(original('docs/recursos.md'), read('docs/recursos.md'));
    await story.check(`só a frase editada mudou (removidas: ${JSON.stringify(diff.removed)}; novas: ${JSON.stringify(diff.added)})`, async () => {
      expect(diff.removed).toEqual(['O ETL roda de hora em hora[^1].']);
      expect(diff.added).toEqual(['O ETL roda de hora em hora[^1]. Fora disso, só sob demanda.']);
    });
    await pause(page);
  });

  await story.step('Glossário (arquivo CRLF, do Windows): editar e salvar mantém o CRLF', async () => {
    const editor = await openFromTree(page, 'Glossário');
    await appendTo(page, editor, 'Termos usados pelo time', ' E pelos parceiros.');
    await save(page);
    const text = read('docs/glossario.md');
    await story.check('todas as linhas continuam com CRLF', async () => expect(text.replace(/\r\n/g, '')).not.toContain('\n'));
    expect(text).toContain('Termos usados pelo time. E pelos parceiros.\r\n');
    await pause(page);
  });

  await story.step('Catálogo de tabelas (3.600 linhas): abre em poucos segundos e a digitação acompanha', async () => {
    const started = Date.now();
    const editor = await openFromTree(page, 'Catálogo de tabelas');
    const seconds = (Date.now() - started) / 1000;
    story.ok(`O catálogo de 3.600 linhas abriu em ${seconds.toFixed(1)} s.`);
    if (seconds > 5) story.suggest(`O catálogo de 3.600 linhas levou ${seconds.toFixed(1)} s para abrir no editor visual.`);
    await toEnd(page);
    const last = editor.locator('.ProseMirror p', { hasText: 'vendas_400' });
    await appendTo(page, editor, 'vendas_400', ' Última tabela.');
    const typed = Date.now();
    await expect(last).toContainText('Última tabela.');
    const ms = Date.now() - typed;
    if (ms > 1500) story.suggest(`Na página grande, o texto digitado levou ${ms} ms para aparecer.`);
    const savedAt = Date.now();
    await save(page);
    story.ok(`Salvar o catálogo levou ${((Date.now() - savedAt) / 1000).toFixed(1)} s.`);
    const diff = changedLines(original('docs/tabelas.md'), read('docs/tabelas.md'));
    await story.check(`só a linha editada mudou no catálogo (${diff.removed.length} removidas, ${diff.added.length} novas)`, async () => {
      expect(diff.removed.length).toBe(1);
      expect(diff.added.length).toBe(1);
    });
    await pause(page);
  });

  await story.step('Alguém muda "Glossário" por fora (git pull) com a página aberta: o editor mostra o texto novo', async () => {
    const editor = await openFromTree(page, 'Glossário');
    const text = read('docs/glossario.md').replace('Extrair, transformar e carregar.', 'Extrair, transformar e carregar (veio do git pull).');
    writeFileSync(join(folder, 'docs/glossario.md'), text);
    await story.check('o editor visual mostra o texto que chegou', () => expect(editor.locator('.ProseMirror')).toContainText('veio do git pull', { timeout: 10_000 }));
    await story.check('a aba não fica como alterada', () => expect(page.locator('.tab.active.dirty')).toHaveCount(0));
    await pause(page);
  });

  await story.step('O mkdocs.yml quebra (YAML inválido): a extensão diz o que houve', async () => {
    const good = read('mkdocs.yml');
    writeFileSync(join(folder, 'mkdocs.yml'), good.replace('nav:\n', 'nav:\n  - Início: index.md\n    - errado: [\n'));
    await page.waitForTimeout(2_500);
    const tree = await page.locator('.part.sidebar').innerText();
    const notices = await page.locator('.notification-toast').allInnerTexts();
    story.ok(`Com o mkdocs.yml quebrado, a barra lateral mostra: ${JSON.stringify(tree.slice(0, 300))}; mensagens: ${JSON.stringify(notices)}.`);
    await palette(page, 'Problems: Focus on Problems View');
    const problems = await page.locator('.markers-panel .monaco-list-row').allInnerTexts();
    if (!problems.some(p => /mkdocs|yaml|YAML/.test(p)) && !/yaml|YAML|mkdocs\.yml/.test(tree + notices.join(' '))) {
      story.suggest('Com o mkdocs.yml inválido, nem a árvore nem o painel Problemas dizem que o arquivo tem erro e onde: a pessoa vê o menu sumir ou ficar velho sem saber por quê.');
    }
    writeFileSync(join(folder, 'mkdocs.yml'), good);
    await story.check('o menu volta quando o arquivo é corrigido', () => expect(treeRow(page, 'Catálogo de tabelas')).toBeVisible({ timeout: 10_000 }));
    await pause(page);
  });

  await story.step('O site gera com o MkDocs', async () => {
    const result = buildSite(folder);
    if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
  });
});
