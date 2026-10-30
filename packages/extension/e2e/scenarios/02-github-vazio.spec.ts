/**
 * Cenário 2: um repositório do GitHub só com o README. A pessoa clona, cria a documentação pela extensão e publica no
 * GitHub (pull request); quem publica faz o merge no site do GitHub (aqui, pelo `gh`). Não vai para o Backstage.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneRepo, freshRepo, mainFile, mergePr, openPrs, type ScenarioRepo } from './github';
import { click, expect, pause, test, type } from './story';
import { addPage, buildSite, editorOf, previewPanel, previewRow, publishStrip, quickInput, save, techdocsIcon, treeRow, turnOnSetting } from './ui';

const NAME = 'techdocs-cenario-vazio';
let repo: ScenarioRepo;

test.use({
  folder: async ({}, use) => {
    repo = freshRepo(NAME, 'github-vazio');
    await use(cloneRepo(repo, NAME));
  },
  // A consulta do pull request sem pipeline (60 s por padrão) no mínimo, para a rodada não esperar
  settings: { 'techdocsEditor.polling.idleIntervalSeconds': 10 },
  scenario: {
    id: '02-github-vazio',
    title: 'Repositório do GitHub vazio: criar a doc e publicar',
    summary:
      'Um repositório do GitHub só com o README, clonado na máquina. A pessoa cria a documentação pela extensão, escreve, liga a publicação, envia (um pull request) e quem publica faz o merge no GitHub. Sem Backstage.',
  },
});

test('repositório do GitHub vazio: criar a doc e publicar', async ({ vscode: { page, workspace }, story }) => {
  const read = (path: string) => readFileSync(join(workspace, path), 'utf8');
  story.outside('Clonar: a pessoa clonou o repositório com o git no terminal e abriu a pasta (o VS Code também clona, pela paleta: Git: Clone).');

  await story.step('Abrir a barra lateral TechDocs no clone', async () => {
    await expect(techdocsIcon(page)).toBeVisible({ timeout: 30_000 });
    await click(page, techdocsIcon(page));
    await expect(page.getByRole('button', { name: 'Prepare the documentation' })).toBeVisible();
    await pause(page);
  });

  await story.step('Preparar: dar um nome ao site e acrescentar uma página', async () => {
    await click(page, page.getByRole('button', { name: 'Prepare the documentation' }));
    const panel = await previewPanel(page);
    await story.check('os templates seguem a língua do README', () => expect(panel.locator('#f-template option').first()).toHaveText('Em branco'));
    if ((await panel.locator('#f-siteName').inputValue()) === NAME) {
      story.suggest(`O nome sugerido para o site é o título do README, "${NAME}" (o nome do repositório). Um nome de pessoa ("Cenário vazio") viria de um título com espaços; vale avisar que é o nome que aparece no portal.`);
    }
    await panel.locator('#f-siteName').fill('');
    await click(page, panel.locator('#f-siteName'));
    await type(page, 'Cenário Vazio');
    await addPage(page, panel, 'Como contribuir', /Guia|How-to/);
    await expect(previewRow(panel, 'como-contribuir.md')).toBeVisible();
    await pause(page, 1_500);
  });

  await story.step('Criar (sem Backstage no workspace, sem pergunta)', async () => {
    const panel = await previewPanel(page);
    await click(page, panel.getByRole('button', { name: 'Create' }));
    // Sem Backstage no workspace (nenhum catalog-info.yaml), não há pergunta sobre o arquivo depois do Criar
    await story.check('sem pergunta sobre o catalog-info.yaml', () => expect(quickInput(page).filter({ hasText: 'Does your Backstage use a catalog-info.yaml' })).toBeHidden());
    await expect(page.locator('.tab.active')).toContainText('index.md', { timeout: 30_000 });
    expect(read('mkdocs.yml')).toContain('site_name: Cenário Vazio');
    await expect(treeRow(page, 'Como contribuir')).toBeVisible();
    await pause(page);
  });

  await story.step('Escrever na página inicial', async () => {
    const editor = await editorOf(page);
    await click(page, editor.locator('.ProseMirror p').last());
    // O End às vezes não leva o cursor (o editor redesenha a seleção no mesmo instante): a pessoa aperta de novo
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await type(page, 'Para propor uma mudança, siga o guia Como contribuir.');
    await save(page);
    expect(read('docs/index.md')).toContain('\n\nPara propor uma mudança, siga o guia Como contribuir.\n');
    await pause(page);
  });

  await story.step('Ligar a publicação no GitHub (Configurações)', async () => {
    const editor = await editorOf(page);
    if (!(await publishStrip(editor).count())) {
      story.suggest(
        'Num clone do GitHub, a página não mostra como publicar: é preciso achar e ligar a configuração "techdocsEditor.local.publishPanel". A extensão podia oferecer isso ao ver o remote do GitHub (uma vez), ou a faixa podia aparecer com "Publicar no GitHub".',
      );
    }
    await turnOnSetting(page, 'techdocsEditor.local.publishPanel', 'Publish Panel');
    await expect(page.locator('.tab.active')).toContainText('index.md');
    await story.check('a faixa de publicação aparece no editor', async () => {
      await expect(publishStrip(await editorOf(page))).toContainText('Send for publication', { timeout: 30_000 });
    });
    await pause(page, 2_000);
  });

  await story.step('Enviar para publicação: o pull request leva o site inteiro', async () => {
    const editor = await editorOf(page);
    await click(page, publishStrip(editor).getByRole('button', { name: 'Send for publication' }));
    await expect(publishStrip(editor)).toContainText('In review', { timeout: 120_000 });
    const prs = openPrs(repo);
    expect(prs).toHaveLength(1);
    await story.check('o pull request leva mkdocs.yml, as páginas e o .markdownlint.yaml', async () => {
      const files = (await import('node:child_process'))
        .execFileSync('gh', ['pr', 'view', String(prs[0].number), '--repo', repo.slug, '--json', 'files', '-q', '.files[].path'], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .sort();
      expect(files).toEqual(['.markdownlint.yaml', 'docs/como-contribuir.md', 'docs/index.md', 'mkdocs.yml']);
    });
    await pause(page, 2_000);
  });

  await story.step('Quem publica faz o merge no GitHub; a página aparece como publicada', async () => {
    const [pr] = openPrs(repo);
    mergePr(repo, pr.number);
    story.outside('O merge foi feito no GitHub (pelo gh, como quem publica faria no site): a extensão não faz merge.');
    expect(mainFile(repo, 'mkdocs.yml')).toContain('Cenário Vazio');
    const editor = await editorOf(page);
    await story.check('a faixa mostra que a página foi publicada (sem fechar a página)', async () => {
      await expect(publishStrip(editor)).toContainText('Published', { timeout: 60_000 });
    });
    story.suggest(
      'Depois do merge, o clone continua na branch do rascunho (docs/<login>/...). A faixa podia oferecer "Voltar para a versão publicada" (trocar para a main, trazer o merge e apagar a branch local), para a próxima mudança começar do que está publicado.',
    );
    await pause(page, 2_000);
  });

  await story.step('O site gera com o MkDocs (como na pipeline do TechDocs)', async () => {
    const result = buildSite(workspace);
    if (result === undefined) return story.suggest('MkDocs não encontrado: defina MKDOCS com o caminho do mkdocs com o techdocs-core.');
    await story.check('mkdocs build --strict sem erros', async () => expect(result.ok, result.output).toBe(true));
  });
});
