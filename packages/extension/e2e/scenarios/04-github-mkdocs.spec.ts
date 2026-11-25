/**
 * Cenário 4: o Cadastro de Clientes, um repositório do GitHub que já tem a documentação (mkdocs.yml, catalog-info.yaml,
 * duas páginas). A pessoa clona, acrescenta um runbook de template, põe uma tabela e um link na Arquitetura, envia o runbook
 * para revisão, manda a Arquitetura no mesmo pull request (Enviar de novo) e quem cuida do repositório faz o merge.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneRepo, freshRepo, mainFile, mergePr, openPrs, type ScenarioRepo } from './github';
import { click, expect, pause, test, type } from './story';
import { buildSite, editorOf, openFromTree, publishStrip, quickInput, save, sendScreen, sidebarAction, techdocsIcon, topBar, treeRow } from './ui';

const NAME = 'techdocs-cenario-mkdocs';
let repo: ScenarioRepo;
const prFiles = (number: number) =>
  execFileSync('gh', ['pr', 'view', String(number), '--repo', repo.slug, '--json', 'files', '-q', '.files[].path'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();

test.use({
  folder: async ({}, use) => {
    repo = freshRepo(NAME, 'github-mkdocs');
    await use(cloneRepo(repo, NAME));
  },
  settings: { 'techdocsEditor.polling.idleIntervalSeconds': 10 },
  scenario: {
    id: '04-github-mkdocs',
    title: 'Repositório do GitHub com mkdocs: acrescentar à doc e publicar',
    summary:
      'O Cadastro de Clientes, um repositório do GitHub que já tem a documentação. A pessoa clona, acrescenta um runbook de template, põe uma tabela e um link na página de Arquitetura, envia para revisão (um só pull request, com Enviar de novo) e quem cuida do repositório faz o merge no GitHub.',
  },
});

test('repositório do GitHub com mkdocs: acrescentar à doc e publicar', async ({ vscode: { page, workspace }, story }) => {
  const read = (path: string) => readFileSync(join(workspace, path), 'utf8');

  await story.step('Abrir a barra lateral TechDocs: as páginas do site', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    await expect(treeRow(page, 'Início')).toBeVisible();
    await expect(treeRow(page, 'Arquitetura')).toBeVisible();
    await pause(page);
  });

  await story.step('Nova página de template: o runbook "Reprocessar eventos"', async () => {
    await sidebarAction(page, 'New page from template');
    const kinds = quickInput(page);
    await expect(kinds).toContainText('New page from template');
    await type(page, 'Runbook');
    await click(page, kinds.locator('.monaco-list-row', { hasText: /^Runbook/ }));
    await expect(quickInput(page)).toContainText('Title of the new page');
    await type(page, 'Reprocessar eventos');
    await page.keyboard.press('Enter');
    await expect(quickInput(page).locator('input')).toHaveValue('runbooks/reprocessar-eventos.md');
    await page.keyboard.press('Enter');
    await expect(quickInput(page)).toContainText('Nome do alerta');
    await type(page, 'Fila de clientes parada');
    await page.keyboard.press('Enter');
    await click(page, quickInput(page).locator('.monaco-list-row', { hasText: /^Add to the nav/ }));
    await expect(page.locator('.tab.active')).toContainText('reprocessar-eventos.md', { timeout: 30_000 });
    await expect(treeRow(page, 'Reprocessar eventos')).toBeVisible();
    expect(read('mkdocs.yml')).toContain('runbooks/reprocessar-eventos.md');
    expect(read('docs/runbooks/reprocessar-eventos.md')).toContain('Fila de clientes parada');
    await pause(page, 1_500);
  });

  await story.step('Escrever no runbook: o primeiro texto a trocar já vem selecionado', async () => {
    const editor = await editorOf(page);
    await expect(editor.locator('.ProseMirror')).toBeFocused();
    const selected = await editor.locator('body').evaluate(() => getSelection()?.toString() ?? '');
    await story.check('o primeiro texto a trocar vem selecionado', async () => expect(selected).not.toBe(''));
    await type(page, 'O consumidor da fila de clientes parou e os eventos estão acumulando.');
    await save(page);
    expect(read('docs/runbooks/reprocessar-eventos.md')).toContain('O consumidor da fila de clientes parou e os eventos estão acumulando.');
    await pause(page);
  });

  await story.step('Enviar o runbook para revisão: o pull request leva a página e o menu', async () => {
    const editor = await editorOf(page);
    await click(page, publishStrip(editor).getByRole('button', { name: /^Send \(\d+\)$/ }));
    const screen = await sendScreen(page);
    await expect(screen.locator('li.item', { hasText: 'Reprocessar eventos' })).toBeVisible({ timeout: 30_000 });
    await click(page, screen.getByRole('button', { name: 'Send for review' }));
    await expect(publishStrip(await editorOf(page))).toContainText('In review', { timeout: 120_000 });
    const prs = openPrs(repo);
    expect(prs).toHaveLength(1);
    await story.check('o PR do runbook leva a página e o mkdocs.yml', async () =>
      expect(prFiles(prs[0].number)).toEqual(['docs/runbooks/reprocessar-eventos.md', 'mkdocs.yml']),
    );
    await pause(page, 1_500);
  });

  await story.step('Arquitetura: tabela dos componentes, com Tab criando as linhas', async () => {
    const editor = await openFromTree(page, 'Arquitetura');
    await click(page, editor.locator('.ProseMirror p').last());
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, 'Os componentes:');
    await page.keyboard.press('Enter');
    await click(page, topBar(editor, 'table'));
    const rows = [
      ['Componente', 'Tecnologia', 'Para que serve'],
      ['API', 'Python (FastAPI)', 'Recebe os pedidos'],
      ['Banco', 'PostgreSQL', 'Guarda os clientes'],
      ['Fila', 'RabbitMQ', 'Avisa os outros sistemas'],
    ];
    await click(page, editor.locator('th').first());
    for (const [r, cells] of rows.entries()) {
      for (const [c, cell] of cells.entries()) {
        await type(page, cell);
        if (r < rows.length - 1 || c < cells.length - 1) await page.keyboard.press('Tab');
      }
    }
    await save(page);
    expect(read('docs/arquitetura.md')).toMatch(/\| Fila +\| RabbitMQ +\| Avisa os outros sistemas +\|/);
    await pause(page);
  });

  await story.step('Arquitetura: link para o runbook pela caixa de link', async () => {
    const editor = await editorOf(page);
    await click(page, editor.locator('.ProseMirror > p').first());
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await type(page, ' Se a fila parar, veja ');
    await click(page, topBar(editor, 'link'));
    const option = editor.locator('.docs-link-pages [role=option]', { hasText: 'Reprocessar eventos' });
    await expect(option).toBeVisible();
    await pause(page);
    await click(page, option);
    await type(page, '.');
    await save(page);
    expect(read('docs/arquitetura.md')).toContain('Se a fila parar, veja [Reprocessar eventos](runbooks/reprocessar-eventos.md).');
    await pause(page);
  });

  await story.step('Enviar de novo: a Arquitetura entra no mesmo pull request', async () => {
    const editor = await editorOf(page);
    await click(page, publishStrip(editor).getByRole('button', { name: /^Send again \(\d+\)$/ }));
    await expect(publishStrip(editor)).not.toContainText('Send again', { timeout: 120_000 });
    const prs = openPrs(repo);
    await story.check('um só pull request, com as duas páginas e o menu', async () => {
      expect(prs).toHaveLength(1);
      await expect.poll(() => prFiles(prs[0].number), { timeout: 30_000 }).toEqual(['docs/arquitetura.md', 'docs/runbooks/reprocessar-eventos.md', 'mkdocs.yml']);
    });
    await pause(page, 1_500);
  });

  await story.step('Quem cuida do repositório faz o merge no GitHub; a página diz que está na documentação', async () => {
    const [pr] = openPrs(repo);
    mergePr(repo, pr.number);
    story.outside('O merge foi feito no GitHub (pelo gh, como quem cuida do repositório faria no site): a extensão não faz merge.');
    expect(mainFile(repo, 'mkdocs.yml')).toContain('runbooks/reprocessar-eventos.md');
    expect(mainFile(repo, 'docs/arquitetura.md')).toContain('Reprocessar eventos');
    await story.check('a faixa da Arquitetura mostra que está na documentação', async () => {
      await expect(publishStrip(await editorOf(page))).toContainText('In the documentation', { timeout: 90_000 });
    });
    await pause(page, 2_000);
  });

  await story.step('O site gera com o MkDocs (o que está publicado, na main)', async () => {
    await story.check('a cópia voltou sozinha para a main, com o merge', async () => {
      expect(execFileSync('git', ['branch', '--show-current'], { cwd: workspace, encoding: 'utf8' }).trim()).toBe('main');
      expect(read('docs/arquitetura.md')).toContain('Reprocessar eventos');
    });
    const result = buildSite(workspace);
    if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
  });
});
