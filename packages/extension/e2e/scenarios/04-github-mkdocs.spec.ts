/**
 * Cenário 4: o Cadastro de Clientes, um repositório do GitHub que já tem a documentação (mkdocs.yml, catalog-info.yaml,
 * duas páginas). A pessoa clona, acrescenta um runbook de template, põe uma tabela e um link na Arquitetura, envia
 * as duas páginas e quem publica faz o merge no GitHub.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneRepo, freshRepo, mainFile, mergePr, openPrs, type ScenarioRepo } from './github';
import { click, expect, pause, test, type } from './story';
import { buildSite, editorOf, openFromTree, publishStrip, quickInput, save, sidebarAction, techdocsIcon, topBar, treeRow, turnOnSetting } from './ui';

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
      'O Cadastro de Clientes, um repositório do GitHub que já tem a documentação. A pessoa clona, acrescenta um runbook de template, põe uma tabela e um link na página de Arquitetura, envia as duas páginas para publicação e quem publica faz o merge no GitHub.',
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

  await story.step('Ligar a publicação no GitHub (Configurações)', async () => {
    await turnOnSetting(page, 'techdocsEditor.local.publishPanel', 'Publish Panel');
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

  await story.step('Enviar o runbook para publicação: o pull request leva a página e o menu', async () => {
    const editor = await editorOf(page);
    await click(page, publishStrip(editor).getByRole('button', { name: 'Send for publication' }));
    await expect(publishStrip(editor)).toContainText('In review', { timeout: 120_000 });
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

  await story.step('Enviar a Arquitetura para publicação', async () => {
    const editor = await editorOf(page);
    await click(page, publishStrip(editor).getByRole('button', { name: /Send for publication|Send again/ }));
    await expect(publishStrip(editor)).toContainText('In review', { timeout: 120_000 });
    const prs = openPrs(repo);
    await story.check('dois pull requests, um por página', async () => expect(prs).toHaveLength(2));
    const arquitetura = prs.find(pr => prFiles(pr.number).includes('docs/arquitetura.md'));
    await story.check('o PR da Arquitetura leva só a Arquitetura', async () => expect(arquitetura && prFiles(arquitetura.number)).toEqual(['docs/arquitetura.md']));
    await pause(page, 1_500);
  });

  await story.step('Quem publica faz o merge dos dois no GitHub; as páginas aparecem como publicadas', async () => {
    const prs = openPrs(repo).sort((a, b) => a.number - b.number);
    for (const pr of prs) mergePr(repo, pr.number);
    story.outside('Os merges foram feitos no GitHub (pelo gh, como quem publica faria no site): a extensão não faz merge.');
    expect(mainFile(repo, 'mkdocs.yml')).toContain('runbooks/reprocessar-eventos.md');
    expect(mainFile(repo, 'docs/arquitetura.md')).toContain('Reprocessar eventos');
    await story.check('a faixa da Arquitetura mostra publicada', async () => {
      await expect(publishStrip(await editorOf(page))).toContainText('Published', { timeout: 60_000 });
    });
    await pause(page, 2_000);
  });

  await story.step('O site gera com o MkDocs (o que está publicado, na main)', async () => {
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: workspace });
    execFileSync('git', ['pull', '-q'], { cwd: workspace });
    story.outside('Para conferir o site publicado, a pessoa voltou para a main e trouxe os merges pelo terminal (git checkout main, git pull).');
    const result = buildSite(workspace);
    if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
  });
});
