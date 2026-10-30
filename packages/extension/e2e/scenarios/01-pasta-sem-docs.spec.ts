/**
 * Cenário 1: a Tarefas API (uma API FastAPI sem documentação), numa pasta local que não vai para o Backstage.
 * A pessoa cria a documentação de serviço do zero pela extensão, escreve as páginas e confere que o site gera.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { click, expect, folderFrom, pause, test, type } from './story';
import { addPage, buildSite, editorOf, hasWarning, openFromTree, previewPanel, previewRow, quickInput, save, techdocsIcon, topBar, treeRow } from './ui';

const folder = folderFrom('tarefas-api', 'tarefas-api');
const read = (path: string) => readFileSync(join(folder, path), 'utf8');

test.use({
  folder,
  scenario: {
    id: '01-pasta-sem-docs',
    title: 'Pasta local sem docs: documentação de serviço do zero',
    summary:
      'A Tarefas API (FastAPI, só código e README em português) numa pasta local, sem Backstage. A pessoa cria a documentação de serviço pela extensão, escreve três páginas (como rodar, referência da API com tabela, página inicial com link) e confere que o site gera.',
  },
});

test('pasta local sem docs: documentação de serviço do zero', async ({ vscode: { page }, story }) => {
  await story.step('Abrir a barra lateral TechDocs numa pasta que só tem o código', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    await expect(page.getByRole('button', { name: 'Prepare the documentation' })).toBeVisible();
    await pause(page);
  });

  await story.step('Preparar a documentação: o painel sugere nome, descrição e arquivos', async () => {
    await click(page, page.getByRole('button', { name: 'Prepare the documentation' }));
    const panel = await previewPanel(page);
    await expect(panel.locator('#f-siteName')).toHaveValue('Tarefas API');
    await expect(panel.locator('#f-description')).toHaveValue(/^API simples de tarefas/);
    // Sem Backstage: o catalog-info.yaml fica desmarcado e o painel diz o que isso significa
    await expect(panel.getByLabel('Include catalog-info.yaml')).not.toBeChecked();
    await expect(panel.getByText('Without this file, the site does not appear in Backstage.')).toBeVisible();
    await story.check('o index.md aparece recuado dentro da pasta docs', async () => {
      const padding = (text: string) => previewRow(panel, text).evaluate(row => parseFloat(getComputedStyle(row).paddingLeft));
      expect(await padding('index.md')).toBeGreaterThan(await padding('mkdocs.yml'));
    });
    await pause(page, 2_000);
  });

  await story.step('Escolher o template "Docs de serviço" (em português, como o README)', async () => {
    const panel = await previewPanel(page);
    await story.check('os templates seguem a língua do README', () => expect(panel.locator('#f-template option')).toContainText(['Docs de serviço']));
    await panel.locator('#f-template').selectOption({ index: 2 });
    await expect(previewRow(panel, 'architecture.md')).toBeVisible();
    story.suggest('O template em português cria architecture.md e operations.md: nomes de arquivo em inglês num site em português (os títulos estão em português).');
    await pause(page, 1_500);
  });

  await story.step('Acrescentar "Como rodar localmente" (guia) e "Referência da API" pelo + Página', async () => {
    const panel = await previewPanel(page);
    await addPage(page, panel, 'Como rodar localmente', /Guia|How-to/);
    await addPage(page, panel, 'Referência da API', /Referência de API|API reference/);
    await expect(previewRow(panel, 'como-rodar-localmente.md')).toBeVisible();
    await expect(previewRow(panel, 'referencia-da-api.md')).toBeVisible();
    await pause(page, 1_500);
  });

  await story.step('Criar: os arquivos são gravados e a página inicial abre no editor visual', async () => {
    const panel = await previewPanel(page);
    await click(page, panel.getByRole('button', { name: 'Create' }));
    // Sem catalog-info.yaml, a extensão pergunta uma vez se o Backstage usa o arquivo: aqui não há Backstage
    const question = quickInput(page).filter({ hasText: 'Does your Backstage use a catalog-info.yaml' });
    await expect(question).toBeVisible();
    story.suggest(
      'Depois do Criar, uma pergunta a mais: "Does your Backstage use a catalog-info.yaml in the repository?". O painel já mostrava o catalog-info.yaml desmarcado; a pergunta podia estar no painel, junto do arquivo.',
    );
    await pause(page);
    await click(page, question.locator('.monaco-list-row', { hasText: /^No\s*Backstage registers/ }));
    await expect(page.locator('.tab.active')).toContainText('index.md', { timeout: 30_000 });
    await editorOf(page);
    for (const file of ['mkdocs.yml', 'docs/index.md', 'docs/architecture.md', 'docs/como-rodar-localmente.md', 'docs/referencia-da-api.md', '.markdownlint.yaml']) {
      expect(() => read(file), file).not.toThrow();
    }
    expect(() => read('catalog-info.yaml'), 'catalog-info.yaml criado sem pedir').toThrow();
    await expect(treeRow(page, 'Como rodar localmente')).toBeVisible();
    await expect(treeRow(page, 'Referência da API')).toBeVisible();
    await pause(page, 1_500);
  });

  await story.step('Escrever "Como rodar localmente": título, lista numerada e bloco de código', async () => {
    const editor = await openFromTree(page, 'Como rodar localmente');
    await story.check('o guia vem em português', () => expect(editor.locator('h2').first()).toHaveText('Objetivo'));
    await editor.locator('.ProseMirror').click();
    await page.keyboard.press('Control+A');
    await type(page, '# Como rodar localmente\n');
    await type(page, 'Você precisa do Python 3.12 ou mais novo.\n');
    await type(page, '## Passos\n');
    await type(page, '1. Instale as dependências.\nSuba a API.\n\n');
    await type(page, '```bash\n');
    await type(page, 'pip install -r requirements.txt\nuvicorn app.main:app --reload');
    await save(page);
    const text = read('docs/como-rodar-localmente.md');
    expect(text).toContain('# Como rodar localmente\n');
    expect(text).toContain('1. Instale as dependências.\n2. Suba a API.');
    expect(text).toContain('```bash\npip install -r requirements.txt\nuvicorn app.main:app --reload\n```');
    await pause(page);
  });

  await story.step('Escrever "Referência da API": tabela de endpoints, com Tab criando as linhas', async () => {
    const editor = await openFromTree(page, 'Referência da API');
    await editor.locator('.ProseMirror').click();
    await page.keyboard.press('Control+A');
    await type(page, '# Referência da API\n');
    await type(page, 'Os endpoints da Tarefas API:\n');
    await click(page, topBar(editor, 'table'));
    const rows = [
      ['Método', 'Caminho', 'O que faz'],
      ['GET', '/health', 'Diz se a API está de pé'],
      ['GET', '/tasks', 'Lista as tarefas'],
      ['POST', '/tasks', 'Cria uma tarefa'],
      ['DELETE', '/tasks/{id}', 'Apaga uma tarefa'],
    ];
    await editor.locator('th').first().click();
    for (const [r, cells] of rows.entries()) {
      for (const [c, cell] of cells.entries()) {
        await type(page, cell);
        if (r < rows.length - 1 || c < cells.length - 1) await page.keyboard.press('Tab');
      }
    }
    await expect(editor.locator('tr')).toHaveCount(5);
    await save(page);
    const text = read('docs/referencia-da-api.md');
    expect(text).toMatch(/\| DELETE +\| \/tasks\/\{id\} +\| Apaga uma tarefa +\|/);
    await pause(page);
  });

  await story.step('Na página inicial, ligar à Referência da API pela caixa de link', async () => {
    const editor = await openFromTree(page, 'Tarefas API');
    const last = editor.locator('.ProseMirror > p').last();
    await last.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await type(page, 'Os endpoints estão na ');
    await click(page, topBar(editor, 'link'));
    const option = editor.locator('.docs-link-pages [role=option]', { hasText: 'Referência da API' });
    await expect(option).toBeVisible();
    await pause(page);
    await click(page, option);
    await save(page);
    expect(read('docs/index.md')).toContain('Os endpoints estão na [Referência da API](referencia-da-api.md)');
    await pause(page);
  });

  await story.step('Nenhum aviso de formatação na árvore', async () => {
    for (const page_ of ['Tarefas API', 'Como rodar localmente', 'Referência da API']) {
      await story.check(`sem ⚠ em ${page_}`, async () => expect(await hasWarning(page, page_)).toBe(false));
    }
    await pause(page);
  });

  await story.step('O site gera com o MkDocs (como na pipeline do TechDocs)', async () => {
    const result = buildSite(folder);
    if (result === undefined) {
      story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core para conferir o site.');
      return;
    }
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
    story.outside('Para ver o site como vai ficar, a pessoa precisa rodar o MkDocs no terminal: a extensão não mostra o site gerado.');
  });
});
