/**
 * Testes de integração do editor visual dentro do VS Code. Só usam a API do VS Code, para a mesma
 * suíte rodar no desktop (@vscode/test-electron) e no navegador (@vscode/test-web).
 *
 * O workspace é uma cópia de test/fixtures (run.mjs): as páginas das wikis e `crlf/pagina.md`, com
 * fim de linha do Windows. Nada é gravado em disco: cada teste reverte o documento no fim.
 */
import { firstToFill, readNav, type NavItem } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import type { DocsItem, DocsTreeView } from '../../../src/docsTreeView';
import type { LintService } from '../../../src/lintService';
import type { LocalSites } from '../../../src/localSites';
import type { NewPageCommand } from '../../../src/templates/newPage';
import type { PrepareContext } from '../../../src/prepareContext';
import type { PublishPanel } from '../../../src/publish/publishPanel';
import type { CatalogOptions } from '../../../src/catalogOptions';
import type { useTestSiteChoice } from '../../../src/chooseSites';
import type { useTestSitePick } from '../../../src/docsTreeView';
import type { TreeActions, useTestAnswers } from '../../../src/treeActions';
import { foldersWithoutDocs } from '../../../src/sitePicker';
import type { CheckView } from '../../../src/checkView';
import type { RepoCheck } from '../../../src/repoCheck';
import type { CentralTemplates } from '../../../src/templates/centralTemplates';
import type { NewSiteCommand } from '../../../src/templates/newSite';
import type { SitePreview } from '../../../src/templates/sitePreview';
import type { VisualEditorProvider } from '../../../src/visualEditorProvider';

function equal<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\n--- esperado\n${String(expected)}\n--- recebido\n${String(actual)}`);
  }
}

function ok(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, message: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value)) {
    if (Date.now() > end) throw new Error(`${message} (último valor: ${JSON.stringify(value)})`);
    await new Promise(resolve => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

/** O nó do site na árvore, escolhendo o site no seletor (um de cada vez). */
function siteItem(docs: DocsTreeView, folder: string) {
  const candidate = docs.siteCandidates.find(c => c.description === folder);
  if (candidate && docs.current !== candidate.key) void docs.select(candidate.key);
  return docs.getChildren().find(item => item.kind === 'site' && item.description === folder);
}

type Api = {
  provider: VisualEditorProvider;
  treeActions: TreeActions;
  sites: LocalSites;
  lint: LintService;
  docs: DocsTreeView;
  newPage: NewPageCommand;
  newSite: NewSiteCommand;
  repoCheck: RepoCheck;
  checkView: CheckView;
  publish: PublishPanel;
  central: CentralTemplates;
  catalogOptions: CatalogOptions;
  prepare: PrepareContext;
  preview: SitePreview;
  useTestSiteChoice: typeof useTestSiteChoice;
  useTestSitePick: typeof useTestSitePick;
  useTestAnswers: typeof useTestAnswers;
};

async function api(): Promise<Api> {
  const extension = vscode.extensions.getExtension<Api>('edtroleis.techdocs-editor');
  ok(extension, 'extensão não encontrada');
  const result = await extension!.activate();
  // Os testes da árvore olham o menu do site (a visão dos arquivos tem o teste dela)
  await result.docs.setMode('menu');
  return result;
}

const provider = async () => (await api()).provider;

async function openVisual(uri: vscode.Uri) {
  await vscode.commands.executeCommand('vscode.openWith', uri, 'techdocsEditor.visual');
  const session = await (await provider()).session(uri);
  const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  ok(document, `documento não aberto: ${uri}`);
  return { session, document: document! };
}

async function closeAll() {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** Posição do botão Desfazer na barra fixa (ver TOP_BAR em test/webview). */
const TOP_BAR_UNDO = 13;

const pages = async () =>
  (await vscode.workspace.findFiles('wiki*/docs/**/*.md')).sort((a, b) => a.path.localeCompare(b.path));

export function defineTests() {
  suite('Editor visual', function () {
    this.timeout(60_000);
    teardown(closeAll);

    test('as páginas das wikis estão no workspace', async () => {
      ok((await pages()).length >= 7, 'menos páginas que o esperado');
    });

    test('abrir não gera alteração, e o editor gravaria cada página byte a byte igual', async () => {
      for (const uri of await pages()) {
        console.log(`    abrindo ${vscode.workspace.asRelativePath(uri)}`);
        const { session, document } = await openVisual(uri);
        const original = document.getText();
        // Dá tempo de o editor avisar uma "mudança" de normalização, se fosse avisar
        await new Promise(resolve => setTimeout(resolve, 500));
        equal(document.isDirty, false, `${uri.path}: ficou com alteração ao abrir`);
        equal(document.getText(), original, `${uri.path}: texto mudou ao abrir`);
        equal(await session.saved(), original, `${uri.path}: ida e volta diferente`);
        await closeAll();
      }
    });

    test('edição no visual chega ao documento só no trecho alterado', async () => {
      const [uri] = await pages();
      const { session, document } = await openVisual(uri);
      const original = document.getText();
      const changes: vscode.TextDocumentContentChangeEvent[] = [];
      const listener = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === document) changes.push(...e.contentChanges);
      });
      session.insert('Parágrafo novo do teste.');
      await until(() => document.getText(), text => text.includes('Parágrafo novo do teste.'), 'edição não chegou');
      await session.settled();
      listener.dispose();
      ok(document.isDirty, 'documento deveria estar alterado');
      ok(
        changes.every(c => c.rangeLength < original.length / 2),
        `troca grande demais: ${JSON.stringify(changes.map(c => c.rangeLength))}`,
      );
    });

    test('desfazer do VS Code volta o documento e o editor visual ao original', async () => {
      const [uri] = await pages();
      const { session, document } = await openVisual(uri);
      const original = document.getText();
      session.insert('Texto para desfazer.');
      await until(() => document.getText(), text => text.includes('Texto para desfazer.'), 'edição não chegou');
      await session.settled();
      await vscode.commands.executeCommand('undo');
      await until(() => document.getText(), text => text === original, 'documento não voltou ao original');
      await until(() => session.saved(), text => text === original, 'editor visual não voltou ao original');
    });

    test('botão Desfazer da barra do editor visual volta o documento ao original', async () => {
      const [uri] = await pages();
      const { session, document } = await openVisual(uri);
      const original = document.getText();
      session.insert('Texto para o botão desfazer.');
      await until(() => document.getText(), text => text.includes('Texto para o botão desfazer.'), 'edição não chegou');
      await session.settled();
      session.clickTopBar(TOP_BAR_UNDO);
      await until(() => document.getText(), text => text === original, 'o botão Desfazer não desfez');
    });

    test('mudança feita fora (editor de texto) aparece no editor visual', async () => {
      const [uri] = await pages();
      const { session, document } = await openVisual(uri);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, document.lineAt(document.lineCount - 1).range.end, '\nLinha vinda do editor de texto.\n');
      ok(await vscode.workspace.applyEdit(edit), 'edição externa recusada');
      const expected = document.getText();
      await until(() => session.saved(), text => text === expected, 'editor visual não recebeu a mudança');
      // O editor visual recarregado não devolve nada ao documento
      await new Promise(resolve => setTimeout(resolve, 500));
      equal(document.getText(), expected, 'o editor visual mexeu no documento depois de recarregar');
    });

    test('arquivo com CRLF continua com CRLF depois de editar', async () => {
      const [uri] = await vscode.workspace.findFiles('crlf/pagina.md');
      ok(uri, 'crlf/pagina.md não encontrado');
      const { session, document } = await openVisual(uri);
      equal(document.eol, vscode.EndOfLine.CRLF, 'fixture deveria ser CRLF');
      equal(await session.saved(), document.getText(), 'ida e volta diferente em CRLF');
      session.insert('Mais uma linha.');
      await until(() => document.getText(), text => text.includes('Mais uma linha.'), 'edição não chegou');
      await session.settled();
      ok(!/[^\r]\n/.test(document.getText()), 'apareceu fim de linha LF no arquivo CRLF');
    });
  });

  suite('Modo local', function () {
    this.timeout(60_000);
    teardown(closeAll);

    const file = (path: string) => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path);
    const visualTabs = (uri: vscode.Uri) =>
      vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(
        t => t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === uri.toString(),
      );
    const textTabs = (uri: vscode.Uri) =>
      vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(
        t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString(),
      );

    test('páginas do docs_dir de cada mkdocs.yml são reconhecidas; o resto não', async () => {
      const { sites } = await api();
      await sites.ready;
      ok(sites.siteOf(file('wiki/docs/index.md')), 'wiki/docs/index.md deveria ser página de docs');
      ok(sites.siteOf(file('wiki-demo/docs/guias/primeiros-passos.md')), 'página da wiki-demo não reconhecida');
      ok(!sites.siteOf(file('crlf/pagina.md')), 'crlf/pagina.md não está em nenhum docs_dir');
      ok(!sites.siteOf(file('wiki/mkdocs.yml')), 'mkdocs.yml não é página');
    });

    test('arquivo com conflito do Git mostra o aviso; resolvido, o editor volta', async () => {
      const uri = file('conflito/pagina.md');
      const conflicted = '# Conflito\n\n<<<<<<< HEAD\nTexto meu.\n=======\nTexto deles.\n>>>>>>> main\n';
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(conflicted));
      try {
        const { session, document } = await openVisual(uri);
        ok(session.conflicted, 'deveria mostrar o aviso de conflito');
        // Resolver no texto: fica o texto dos dois lados
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), '# Conflito\n\nTexto meu.\n\nTexto deles.\n');
        ok(await vscode.workspace.applyEdit(edit), 'edição recusada');
        await until(() => session.conflicted, value => !value, 'o aviso não saiu depois de resolver');
        await until(() => session.saved(), text => text === document.getText(), 'o editor não voltou com o texto resolvido');
        await vscode.commands.executeCommand('workbench.action.files.revert');
      } finally {
        await closeAll();
        await vscode.workspace.fs.delete(uri);
      }
    });

    test('openVisualByDefault: página de docs aberta como texto vai para o visual; fora do docs_dir, não', async () => {
      const config = vscode.workspace.getConfiguration();
      await config.update('techdocsEditor.openVisualByDefault', true, vscode.ConfigurationTarget.Workspace);
      try {
        await (await api()).sites.ready;
        const page = file('wiki/docs/index.md');
        await vscode.window.showTextDocument(page);
        await until(() => visualTabs(page).length, n => n === 1, 'a página não foi para o visual');
        await until(() => textTabs(page).length, n => n === 0, 'a aba de texto continuou aberta');
        await (await provider()).session(page);
        // "Abrir como texto" com o visual aberto: o texto fica ao lado
        await vscode.commands.executeCommand('techdocsEditor.openText', page);
        await until(() => textTabs(page).length, n => n === 1, 'o texto pedido ao lado não abriu');
        await new Promise(resolve => setTimeout(resolve, 500));
        equal(textTabs(page).length, 1, 'o texto pedido ao lado foi trocado pelo visual');
        await closeAll();

        const other = file('crlf/pagina.md');
        await vscode.window.showTextDocument(other);
        await new Promise(resolve => setTimeout(resolve, 1_000));
        equal(visualTabs(other).length, 0, 'arquivo fora do docs_dir foi para o visual');
      } finally {
        await config.update('techdocsEditor.openVisualByDefault', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });

    test('openVisualByDefault desligado (padrão): página de docs abre como texto', async () => {
      const page = file('wiki/docs/index.md');
      await vscode.window.showTextDocument(page);
      await new Promise(resolve => setTimeout(resolve, 1_000));
      equal(visualTabs(page).length, 0, 'abriu no visual com a configuração desligada');
    });
  });

  suite('Lint', function () {
    this.timeout(60_000);
    teardown(async () => {
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
    });

    const file = (path: string) => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path);
    const ours = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).filter(d => d.source === 'TechDocs');
    const rules = (uri: vscode.Uri) => ours(uri).map(d => (d.code as { value: string }).value).sort();

    async function appendLines(document: vscode.TextDocument, text: string) {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, document.lineAt(document.lineCount - 1).range.end, text);
      ok(await vscode.workspace.applyEdit(edit), 'edição recusada');
    }

    test('as páginas das wikis de teste não têm problemas', async () => {
      await (await api()).sites.ready;
      for (const uri of await pages()) {
        const document = await vscode.workspace.openTextDocument(uri);
        const problems = await (await api()).lint.lintNow(document);
        equal(JSON.stringify(problems), '[]', `${vscode.workspace.asRelativePath(uri)} com problemas`);
      }
    });

    test('a dica do ⚠ na árvore só manda usar Ajustar agora quando ele resolve', async () => {
      const { docs } = await api();
      await docs.ready;
      const uri = file('wiki/docs/index.md');
      const wiki = await until(() => siteItem(docs, 'wiki'), Boolean, 'site wiki não está na árvore');
      docs.getChildren(wiki);
      const page = await until(() => docs.pageItem(uri), Boolean, 'a página não está na árvore');
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      const tooltip = () => String(docs.getTreeItem(page!).tooltip);
      // Link vazio (MD042): não tem ajuste automático
      await appendLines(document, '\n[vazio]()\n');
      await until(() => rules(uri), r => r.join() === 'MD042', 'o MD042 não apareceu');
      equal(tooltip(), '1 formatting problem. Open the page to see what to change.', 'só problema sem ajuste');
      // Título que pula um nível (MD001): o Ajustar agora resolve
      await appendLines(document, '\n#### Pulou um nível\n');
      await until(() => rules(uri), r => r.join() === 'MD001,MD042', 'o MD001 não apareceu');
      equal(tooltip(), '2 formatting problems, 1 with an automatic fix. Open the page to see them.', 'com e sem ajuste');
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await appendLines(document, '\n#### Pulou um nível\n');
      await until(() => rules(uri), r => r.join() === 'MD001', 'só o MD001');
      equal(tooltip(), '1 formatting problem. Open the page and use Fix automatically.', 'só problema com ajuste');
    });

    test('problema aparece no painel com a linha e o texto simples; a configuração da pipeline vale', async () => {
      await (await api()).sites.ready;
      const uri = file('wiki/docs/index.md');
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      const long = 'Uma linha bem comprida '.repeat(8);
      await appendLines(document, `\n${long}<b>html</b>\n\nTexto com espaços no fim.   \n`);
      await until(() => rules(uri), r => r.includes('MD009'), 'o problema não apareceu no painel');
      equal(rules(uri).join(), 'MD009', 'só o MD009: MD013 e MD033 estão desligados no .markdownlint.yaml');
      const [diagnostic] = ours(uri);
      equal(diagnostic.message, 'There are extra spaces at the end of the line', 'texto do problema');
      equal(document.lineAt(diagnostic.range.start.line).text, 'Texto com espaços no fim.   ', 'linha do problema');
      equal(diagnostic.severity, vscode.DiagnosticSeverity.Warning, 'gravidade');
    });

    test('"Ajustar a formatação automaticamente" na lâmpada corrige e o aviso some', async () => {
      await (await api()).sites.ready;
      const uri = file('wiki/docs/index.md');
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      const original = document.getText();
      await appendLines(document, '\nTexto com espaços no fim.   \n');
      // O aviso desta linha (não um que sobrou do teste anterior, antes do lint do texto revertido)
      await until(
        () => ours(uri).map(d => (d.range.start.line < document.lineCount ? document.lineAt(d.range.start.line).text : '')),
        lines => lines.length === 1 && lines[0] === 'Texto com espaços no fim.   ',
        'o problema não apareceu',
      );
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        ours(uri)[0].range,
        vscode.CodeActionKind.QuickFix.value,
      );
      const fix = actions.find(a => a.title === 'Fix formatting automatically');
      ok(fix?.edit, `ação de correção não oferecida: [${actions.map(a => a.title).join(', ')}]`);
      ok(await vscode.workspace.applyEdit(fix!.edit!), 'correção recusada');
      equal(document.getText(), `${original}\nTexto com espaços no fim.\n`, 'texto corrigido');
      await until(() => ours(uri).length, n => n === 0, 'o aviso não saiu depois de corrigir');
    });

    test('problema sem correção automática não oferece a lâmpada', async () => {
      await (await api()).sites.ready;
      const uri = file('wiki/docs/index.md');
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      await appendLines(document, '\n```\nsem linguagem\n```\n');
      await until(() => rules(uri).join(), r => r === 'MD040', 'o problema não apareceu');
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        ours(uri)[0].range,
        vscode.CodeActionKind.QuickFix.value,
      );
      equal(actions.filter(a => a.title === 'Fix formatting automatically').length, 0, 'lâmpada num problema sem correção');
    });

    test('arquivo fora de um docs_dir não é verificado', async () => {
      const uri = file('crlf/pagina.md');
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);
      await appendLines(document, '\r\nTexto com espaços no fim.   \r\n');
      await new Promise(resolve => setTimeout(resolve, 1_000));
      equal(ours(uri).length, 0, 'arquivo fora do docs_dir com diagnostics');
    });

    test('"Ajustar agora" no editor visual corrige o documento', async () => {
      await (await api()).sites.ready;
      const uri = file('wiki/docs/index.md');
      const { session, document } = await openVisual(uri);
      // Um Título 1 a mais, vindo do texto (o visual não produz espaços no fim: o tidy tira)
      await appendLines(document, '\n# Seção extra\n\nTexto da seção.\n');
      await until(async () => (await api()).lint.problems(uri).map(p => p.rule).join(), r => r === 'MD025', 'lint não rodou');
      await until(() => session.saved(), text => text === document.getText(), 'o visual não recebeu a mudança');
      session.click('.problems-fix');
      await until(() => document.getText(), text => text.includes('\n## Seção extra\n'), 'a correção não chegou ao documento');
      await until(async () => (await api()).lint.problems(uri).length, n => n === 0, 'o problema continuou');
      await until(() => session.saved(), text => text === document.getText(), 'o visual não recebeu o texto corrigido');
    });
  });

  suite('Imagens', function () {
    this.timeout(60_000);
    const file = (path: string) => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path);
    const assets = file('wiki/docs/assets');
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const assetNames = async () => (await vscode.workspace.fs.readDirectory(assets)).map(([name]) => name).sort();
    let before: string[] = [];

    setup(async () => {
      before = await assetNames();
    });
    teardown(async () => {
      for (const name of await assetNames()) {
        if (!before.includes(name)) await vscode.workspace.fs.delete(vscode.Uri.joinPath(assets, name));
      }
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await closeAll();
    });

    /** Página de uma subpasta com um bloco de imagem vazio, pronto para escolher o arquivo. */
    async function pageWithImageBlock() {
      await (await api()).sites.ready;
      const opened = await openVisual(file('wiki/docs/guias/primeiros-passos.md'));
      opened.session.insert('![]()');
      // O bloco entra no cursor (começo do título) e o que isso muda chega ao documento com atraso:
      // espera o documento ficar igual ao editor antes de escolher a imagem
      await until(
        async () => (await opened.session.saved()) === opened.document.getText(),
        same => same,
        'o documento não acompanhou o bloco de imagem',
      );
      await opened.session.settled();
      return opened;
    }

    test('grava em <docs>/assets/<horário>-<nome> e põe o link relativo à página', async () => {
      const { session, document } = await pageWithImageBlock();
      session.chooseImage('Captura de Tela.png', 'image/png', PNG);
      const text = await until(() => document.getText(), t => t.includes('](../assets/'), 'o link não chegou ao documento');
      const [link] = /\.\.\/assets\/\d+-captura-de-tela\.png/.exec(text) ?? [];
      ok(link, `link inesperado: ${text}`);
      ok(!text.includes('blob:'), 'link temporário (blob:) no documento');
      const saved = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(file('wiki/docs/guias'), link!));
      equal(Array.from(saved).join(), Array.from(PNG).join(), 'bytes gravados diferentes dos enviados');
    });

    test('arquivo que não é imagem é recusado: nada gravado, nada no documento', async () => {
      const { session, document } = await pageWithImageBlock();
      const original = document.getText();
      session.chooseImage('notas.pdf', 'application/pdf', PNG);
      await new Promise(resolve => setTimeout(resolve, 1_500));
      equal((await assetNames()).join(), before.join(), 'gravou arquivo recusado');
      ok(!document.getText().includes('notas'), 'arquivo recusado no documento');
      equal(document.getText(), original, 'documento mudou');
    });

    test('imagem acima de techdocsEditor.images.maxSizeMB é recusada', async () => {
      const config = vscode.workspace.getConfiguration();
      await config.update('techdocsEditor.images.maxSizeMB', 0.001, vscode.ConfigurationTarget.Workspace);
      try {
        const { session, document } = await pageWithImageBlock();
        const original = document.getText();
        session.chooseImage('grande.png', 'image/png', new Uint8Array(2048));
        await new Promise(resolve => setTimeout(resolve, 1_500));
        equal((await assetNames()).join(), before.join(), 'gravou imagem acima do limite');
        equal(document.getText(), original, 'documento mudou');
      } finally {
        await config.update('techdocsEditor.images.maxSizeMB', undefined, vscode.ConfigurationTarget.Workspace);
      }
    });
  });

  suite('Documentação', function () {
    this.timeout(60_000);
    const file = (path: string) => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path);
    /** A árvore como texto: um item por linha, recuado pelo nível, com o tipo quando não é página. */
    const outline = (docs: DocsTreeView, items: DocsItem[], depth = 0): string[] =>
      items.flatMap(item => [
        `${'  '.repeat(depth)}${item.label}${item.kind === 'page' ? '' : ` (${item.kind})`}`,
        ...outline(docs, docs.getChildren(item), depth + 1),
      ]);

    test('site sem nav: pelas pastas, com o título 1 de cada página', async () => {
      const { docs } = await api();
      await docs.ready;
      const wiki = await until(() => siteItem(docs, 'wiki'), Boolean, 'site wiki não está na árvore');
      equal(
        outline(docs, docs.getChildren(wiki)).join('\n'),
        ['Wiki de Demonstração', 'Guias (section)', '  Imagens', '  Primeiros passos', 'Processos (section)', '  Processo de aprovação'].join('\n'),
        'árvore da wiki',
      );
      const page = docs.pageItem(file('wiki/docs/guias/imagens.md'));
      ok(page, 'página sem item');
      equal(docs.getTreeItem(page!).command?.command, 'techdocsEditor.openVisual', 'clicar na página não a abre no editor visual');
    });

    test('caixa de link: as outras páginas do site, com o link relativo à página aberta', async () => {
      const { docs } = await api();
      await docs.ready;
      await until(() => siteItem(docs, 'wiki'), Boolean, 'site wiki não está na árvore');
      const uri = file('wiki/docs/guias/imagens.md');
      await until(() => docs.pageItem(uri), Boolean, 'página sem item');
      equal(
        JSON.stringify(docs.linkTargets(uri)),
        JSON.stringify([
          { title: 'Wiki de Demonstração', href: '../index.md', detail: 'index.md' },
          { title: 'Primeiros passos', href: 'primeiros-passos.md', detail: 'guias/primeiros-passos.md', section: 'Guias' },
          { title: 'Processo de aprovação', href: '../processos/aprovacao.md', detail: 'processos/aprovacao.md', section: 'Processos' },
        ]),
        'páginas da caixa de link',
      );
    });

    test('site com nav: na ordem do nav, página que não existe e páginas fora do nav', async () => {
      const { docs } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      await write('nav-site/docs/index.md', '# Início\n');
      await write('nav-site/docs/b.md', '# Página B\n');
      await write('nav-site/docs/solta.md', '# Solta\n');
      await write(
        'nav-site/mkdocs.yml',
        'site_name: Com nav\nnav:\n  - Começo: index.md\n  - Seção:\n    - b.md\n    - Some: nao-existe.md\n  - GitHub: https://github.com\n',
      );
      try {
        const expected = [
          'Começo',
          'Seção (section)',
          '  Página B',
          '  Some (missing)',
          'GitHub (link)',
          'Fora do menu (notInNav)',
          '  Solta',
        ];
        const actual = () => {
          const site = siteItem(docs, 'nav-site');
          return site ? outline(docs, docs.getChildren(site)).join('\n') : '';
        };
        const english = expected.map(line => line.replace('Fora do menu', 'Not in the menu')).join('\n');
        await until(actual, text => text === english || text === expected.join('\n'), 'árvore do site com nav');
        // Título mudou no arquivo: a árvore acompanha
        await write('nav-site/docs/b.md', '# Outro título\n');
        await until(actual, text => text.includes('  Outro título'), 'título novo não chegou à árvore');
      } finally {
        await vscode.workspace.fs.delete(file('nav-site'), { recursive: true });
      }
      await until(() => siteItem(docs, 'nav-site') === undefined, gone => gone, 'site removido continuou na árvore');
    });

    test('árvore: renomear, mover, pôr no menu, excluir com desfazer, seções e site sem nav', async () => {
      const { docs, sites, useTestAnswers } = await api();
      await sites.ready;
      const t = (en: string, pt: string) => (vscode.env.language.startsWith('pt') ? pt : en);
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const read = async (path: string) => new TextDecoder().decode(await vscode.workspace.fs.readFile(file(path)));
      const exists = (path: string) => vscode.workspace.fs.stat(file(path)).then(() => true, () => false);
      /** O menu como texto: `Título[a.md, b.md]`. */
      const menu = async (site: string) => {
        const show = (items: NavItem[]): string => items.map(i => (i.kind === 'section' ? `${i.title}[${show(i.children)}]` : i.kind === 'page' ? i.path : i.url)).join(', ');
        const nav = readNav(await read(`${site}/mkdocs.yml`));
        return nav ? show(nav) : '(sem nav)';
      };
      const find = (label: string) => {
        const walk = (items: DocsItem[]): DocsItem | undefined => {
          for (const item of items) {
            if (item.label === label) return item;
            const inner = walk(docs.getChildren(item));
            if (inner) return inner;
          }
          return undefined;
        };
        return walk(docs.getChildren());
      };
      const run = async (command: string, label: string, ...answers: string[]) => {
        const item = await until(() => find(label), Boolean, `"${label}" não está na árvore`);
        useTestAnswers(answers);
        try {
          await vscode.commands.executeCommand(command, item);
        } finally {
          useTestAnswers(undefined);
        }
        await docs.ready;
      };
      await write('acoes/mkdocs.yml', 'site_name: Ações # o site\nnav:\n  - Início: index.md\n  - Guias:\n      - guias/a.md\n      - guias/b.md\n  - c.md\n');
      await write('acoes/docs/index.md', '# Início\n\nVeja [A](guias/a.md).\n');
      await write('acoes/docs/guias/a.md', '# Página A\n\n![só dela](../img/so-a.png)\n');
      await write('acoes/docs/guias/b.md', '# Página B\n');
      await write('acoes/docs/c.md', '# Página C\n');
      await write('acoes/docs/solta.md', '# Solta\n');
      await vscode.workspace.fs.writeFile(file('acoes/docs/img/so-a.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      await write('semnav/mkdocs.yml', 'site_name: Sem nav\n');
      await write('semnav/docs/a.md', '# Página A\n');
      await write('semnav/docs/b.md', '# Página B\n');
      try {
        // Gravado de novo a cada tentativa: logo depois de abrir, o observador dos mkdocs.yml pode não estar ativo
        const yml = await read('acoes/mkdocs.yml');
        await until(
          async () => {
            if (!siteItem(docs, 'acoes')) await write('acoes/mkdocs.yml', yml);
            await docs.ready;
            await new Promise(resolve => setTimeout(resolve, 400));
            return siteItem(docs, 'acoes') ?? `${docs.siteCandidates.map(c => c.description).join(',')} / ${sites.all().map(x => x.site.root.split('/').pop()).join(',')}`;
          },
          found => typeof found !== 'string',
          'site acoes não entrou na árvore',
          20_000,
        );

        // Renomear: muda o título 1; o arquivo e o menu (sem título escrito) ficam
        await run('techdocsEditor.renameItem', 'Página A', 'Página A2');
        ok((await read('acoes/docs/guias/a.md')).startsWith('# Página A2\n'), 'título não mudou no arquivo');
        // Mover: um passo, para outra seção e pôr no menu a página de fora
        await run('techdocsEditor.moveDown', 'Página A2');
        await run('techdocsEditor.moveItem', 'Página C', 'Guias');
        await run('techdocsEditor.addToMenu', 'Solta');
        equal(await menu('acoes'), 'index.md, Guias[guias/b.md, guias/a.md, c.md], solta.md', 'menu depois de mover');
        ok((await read('acoes/mkdocs.yml')).startsWith('site_name: Ações # o site\n'), 'o resto do mkdocs.yml mudou');

        // Excluir: a página, a imagem só dela e a entrada no menu; desfazer põe tudo de volta
        await run('techdocsEditor.deleteItem', 'Página A2', t('Delete', 'Excluir'));
        ok(!(await exists('acoes/docs/guias/a.md')), 'a página ficou');
        ok(!(await exists('acoes/docs/img/so-a.png')), 'a imagem só dela ficou');
        equal(await menu('acoes'), 'index.md, Guias[guias/b.md, c.md], solta.md', 'menu depois de excluir');
        await vscode.commands.executeCommand('techdocsEditor.undoTreeEdit');
        ok((await exists('acoes/docs/guias/a.md')) && (await exists('acoes/docs/img/so-a.png')), 'desfazer não trouxe de volta');
        equal(await menu('acoes'), 'index.md, Guias[guias/b.md, guias/a.md, c.md], solta.md', 'menu depois de desfazer');
        // A página inicial não sai
        await run('techdocsEditor.deleteItem', 'Início');
        ok(await exists('acoes/docs/index.md'), 'a página inicial foi excluída');

        // Seções: excluir só a seção (as páginas ficam), nova seção com a primeira página, duplicar
        await run('techdocsEditor.deleteItem', 'Guias', t('Only the section', 'Só a seção'));
        equal(await menu('acoes'), 'index.md, guias/b.md, guias/a.md, c.md, solta.md', 'menu depois de excluir a seção');
        await run('techdocsEditor.newSection', 'Página C', 'Referência');
        equal(await read('acoes/docs/referencia/index.md'), '# Referência\n', 'primeira página da seção');
        equal(await menu('acoes'), 'index.md, guias/b.md, guias/a.md, c.md, solta.md, Referência[referencia/index.md]', 'menu com a seção nova');
        await run('techdocsEditor.duplicatePage', 'Página C', 'Página C2');
        ok((await read('acoes/docs/pagina-c2.md')).startsWith('# Página C2\n'), 'cópia sem o título novo');
        equal(await menu('acoes'), 'index.md, guias/b.md, guias/a.md, c.md, pagina-c2.md, solta.md, Referência[referencia/index.md]', 'cópia logo depois da original');
        await run('techdocsEditor.deleteItem', 'Referência', t('Section and pages', 'Seção e páginas'));
        ok(!(await exists('acoes/docs/referencia')), 'a pasta da seção ficou');

        // Página do menu que não existe: criar (com o título do menu) ou tirar do menu
        const before = await read('acoes/mkdocs.yml');
        await write('acoes/mkdocs.yml', `${before}  - Sumida: sumida.md\n  - Velha: guias/velha.md\n`);
        await run('techdocsEditor.createMissingPage', 'Sumida');
        equal(await read('acoes/docs/sumida.md'), '# Sumida\n', 'página criada');
        await run('techdocsEditor.removeFromMenu', 'Velha');
        equal(await read('acoes/mkdocs.yml'), `${before}  - Sumida: sumida.md\n`, 'só a entrada da página que não existe sai');

        // Site sem nav: mover pergunta e escreve o menu de hoje (sem páginas do outro site abertas, que puxam a árvore)
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await until(
          async () => {
            if (!siteItem(docs, 'semnav')) await write('semnav/mkdocs.yml', 'site_name: Sem nav\n');
            await docs.ready;
            await new Promise(resolve => setTimeout(resolve, 400));
            return siteItem(docs, 'semnav');
          },
          Boolean,
          'site semnav não entrou na árvore',
          20_000,
        );
        await run('techdocsEditor.moveUp', 'Página B', t('Organize the menu', 'Organizar o menu'));
        equal(await menu('semnav'), 'b.md, a.md', 'menu escrito na ordem nova');
      } finally {
        useTestAnswers(undefined);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.workspace.fs.delete(file('acoes'), { recursive: true });
        await vscode.workspace.fs.delete(file('semnav'), { recursive: true });
      }
      // O próximo teste conta os sites: espera estes saírem
      await until(() => sites.all().filter(s => /\/(acoes|semnav)$/.test(s.site.root)).length, n => n === 0, 'os sites do teste não saíram');
      await docs.refreshNow();
    });

    test('visão dos arquivos: pasta da docs movida (menu e arrastando), renomeada e excluída, com o menu, os links e o desfazer', async () => {
      const { docs, sites, useTestAnswers, treeActions } = await api();
      await sites.ready;
      const t = (en: string, pt: string) => (vscode.env.language.startsWith('pt') ? pt : en);
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const read = async (path: string) => new TextDecoder().decode(await vscode.workspace.fs.readFile(file(path)));
      const exists = (path: string) => Promise.resolve(vscode.workspace.fs.stat(file(path))).then(() => true, () => false);
      const menu = async () => {
        const show = (items: NavItem[]): string => items.map(i => (i.kind === 'section' ? `${i.title}[${show(i.children)}]` : i.kind === 'page' ? i.path : i.url)).join(', ');
        return show(readNav(await read('pastas/mkdocs.yml')) ?? []);
      };
      const find = (label: string, kind = 'dir') => {
        const walk = (items: DocsItem[]): DocsItem | undefined => {
          for (const item of items) {
            if (item.label === label && item.kind === kind) return item;
            const inner = walk(docs.getChildren(item));
            if (inner) return inner;
          }
          return undefined;
        };
        return walk(docs.getChildren());
      };
      const run = async (command: string, label: string, ...answers: string[]) => {
        const item = await until(() => find(label), Boolean, `"${label}" não está na árvore`);
        useTestAnswers(answers);
        try {
          await vscode.commands.executeCommand(command, item);
        } finally {
          useTestAnswers(undefined);
        }
        await docs.ready;
      };
      const yml = 'site_name: Pastas\nnav:\n  - Início: index.md\n  - Manual:\n      - manual/a.md\n      - manual/b.md\n  - Destino:\n      - destino/x.md\n';
      await write('pastas/docs/index.md', '# Início\n\nVeja [A](manual/a.md).\n');
      await write('pastas/docs/manual/a.md', '# Página A\n\nVeja [X](../destino/x.md) e ![fig](fig.png).\n');
      await write('pastas/docs/manual/b.md', '# Página B\n');
      await vscode.workspace.fs.writeFile(file('pastas/docs/manual/fig.png'), new Uint8Array([0x89, 0x50]));
      await write('pastas/docs/destino/x.md', '# Página X\n');
      await docs.setMode('files');
      try {
        await until(
          async () => {
            // Gravado de novo a cada tentativa: logo depois de abrir, o observador dos mkdocs.yml pode não estar ativo
            if (!siteItem(docs, 'pastas')) await write('pastas/mkdocs.yml', yml);
            await docs.refreshNow();
            await new Promise(resolve => setTimeout(resolve, 400));
            return siteItem(docs, 'pastas') && find('manual');
          },
          Boolean,
          'site pastas não entrou na árvore',
          20_000,
        );

        // A página mostra o nome do arquivo e, ao lado, o título (vários index.md se distinguem)
        const shown = docs.getTreeItem(find('Página A', 'page')!);
        equal(`${shown.label} | ${shown.description}`, 'a.md | Página A', 'a linha da página');

        // Mover pelo menu: a pasta inteira, com o menu e os links (de fora e de dentro) acertados
        await run('techdocsEditor.moveItem', 'manual', 'destino');
        ok(await exists('pastas/docs/destino/manual/a.md'), 'a página não foi junto');
        ok(await exists('pastas/docs/destino/manual/fig.png'), 'a imagem não foi junto');
        ok(!(await exists('pastas/docs/manual')), 'a pasta antiga ficou');
        equal(await menu(), 'index.md, Manual[destino/manual/a.md, destino/manual/b.md], Destino[destino/x.md]', 'menu depois de mover');
        ok((await read('pastas/docs/index.md')).includes('(destino/manual/a.md)'), 'o link de fora não acompanhou');
        ok((await read('pastas/docs/destino/manual/a.md')).includes('[X](../x.md)'), 'o link de dentro não acompanhou');

        // Desfazer: tudo de volta, sem pasta vazia sobrando
        await vscode.commands.executeCommand('techdocsEditor.undoTreeEdit');
        ok(await exists('pastas/docs/manual/a.md'), 'desfazer não voltou a página');
        ok(!(await exists('pastas/docs/destino/manual')), 'desfazer deixou a pasta movida');
        equal(await menu(), 'index.md, Manual[manual/a.md, manual/b.md], Destino[destino/x.md]', 'menu depois de desfazer');

        // Arrastar a pasta para cima de outra
        await until(() => find('manual'), Boolean, 'manual não voltou à árvore');
        const data = new vscode.DataTransfer();
        treeActions.handleDrag([find('manual')!], data);
        await treeActions.handleDrop(find('destino'), data);
        ok(await exists('pastas/docs/destino/manual/b.md'), 'arrastar não moveu a pasta');
        await vscode.commands.executeCommand('techdocsEditor.undoTreeEdit');
        await until(() => find('manual'), Boolean, 'manual não voltou à árvore depois de desfazer o arrastar');

        // Renomear: a pasta, o menu e o link de fora
        await run('techdocsEditor.renameItem', 'manual', 'guia');
        ok(await exists('pastas/docs/guia/a.md'), 'renomear não mudou a pasta');
        equal(await menu(), 'index.md, Manual[guia/a.md, guia/b.md], Destino[destino/x.md]', 'menu depois de renomear');
        ok((await read('pastas/docs/index.md')).includes('(guia/a.md)'), 'o link não acompanhou o nome novo');

        // Excluir: a pasta vai embora e as páginas saem do menu
        await run('techdocsEditor.deleteItem', 'guia', t('Delete', 'Excluir'));
        ok(!(await exists('pastas/docs/guia')), 'a pasta não foi excluída');
        equal(await menu(), 'index.md, Manual[], Destino[destino/x.md]', 'menu depois de excluir');
      } finally {
        await docs.setMode('menu');
        await vscode.workspace.fs.delete(file('pastas'), { recursive: true }).then(undefined, () => undefined);
      }
    });

    test('visão dos arquivos: a pasta do site, com as pastas e .md pelo nome, fora do menu marcado; usar o título da página no menu; README para uma página', async () => {
      const { docs, useTestAnswers } = await api();
      const read = async (path: string) => new TextDecoder().decode(await vscode.workspace.fs.readFile(file(path)));
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const yml = await read('wiki/mkdocs.yml');
      const names = (items: DocsItem[]): string[] =>
        items.flatMap(item => [
          item.kind === 'dir' ? `${item.label}/` : item.kind !== 'page' ? `${item.label} (${item.kind}${item.missingInMenu ? `, ${item.missingInMenu} do menu sem página` : ''})` : `${item.uri!.path.split('/').pop()}${item.outside ? ' (fora)' : ''}${item.fixedTitle ? ' (título fixo)' : ''}`,
          ...names(item.children).map(name => `  ${name}`),
        ]);
      try {
        await write('wiki/mkdocs.yml', `${yml}\nnav:\n  - Início: index.md\n  - Guias:\n    - guias/primeiros-passos.md\n  - Sumiu: sumiu.md\n`);
        await write('wiki/README.md', '# Leia-me\n\nVeja [o diagrama](docs/assets/diagrama.png), ![o logo](img/logo.png) e [o código](app/main.py).\n');
        await write('wiki/app/main.py', 'print(1)\n');
        await write('wiki/img/logo.png', 'png');
        // Um repositório Git: a árvore começa na raiz dele; o código vira o endereço no GitHub (o repo_url do mkdocs.yml vence o origin)
        await write('wiki/.git/config', '[remote "origin"]\n\turl = git@github.com:acme/wiki.git\n');
        await write('wiki/.git/refs/remotes/origin/HEAD', 'ref: refs/remotes/origin/main\n');
        await docs.setMode('files');
        const tree = await until(
          async () => {
            await docs.refreshNow();
            const site = siteItem(docs, 'wiki');
            return site ? names(docs.getChildren(site)).join('\n') : '';
          },
          found => found.includes('título fixo'),
          'a visão dos arquivos não montou',
        );
        equal(
          tree,
          [
            // O repositório como no disco (sem o .git): o código para consultar (lido quando abre) e o docs_dir aberto
            'app (repoDir)',
            'docs/',
            '  assets/',
            '    diagrama.png (asset)',
            '  guias/',
            '    imagens.md (fora)',
            '    primeiros-passos.md',
            '  processos/',
            '    aprovacao.md (fora)',
            '  index.md (título fixo)',
            'img (repoDir)',
            '.markdownlint.yaml (repoFile)',
            // A página do menu que não existe: o ⚠ no mkdocs.yml leva à visão do menu
            'mkdocs.yml (repoFile, 1 do menu sem página)',
            'README.md (repoFile)',
          ].join('\n'),
          'visão dos arquivos',
        );
        const index = docs.pageItem(file('wiki/docs/index.md'))!;
        equal(index.label, 'Início', 'o título continua no item (dica, links)');

        useTestAnswers([]);
        await vscode.commands.executeCommand('techdocsEditor.usePageTitle', index);
        ok((await read('wiki/mkdocs.yml')).includes('  - index.md\n'), 'o nav continuou com o título fixo');
        ok(!docs.pageItem(file('wiki/docs/index.md'))!.fixedTitle, 'a árvore continuou com o título fixo');

        // Renomear o arquivo: o nav e o link do index.md acompanham
        const exists = (path: string) => vscode.workspace.fs.stat(file(path)).then(() => true, () => false);
        const home = await read('wiki/docs/index.md');
        useTestAnswers(['comecar.md']);
        await vscode.commands.executeCommand('techdocsEditor.renameItem', docs.pageItem(file('wiki/docs/guias/primeiros-passos.md')));
        ok((await exists('wiki/docs/guias/comecar.md')) && !(await exists('wiki/docs/guias/primeiros-passos.md')), 'o arquivo não mudou de nome');
        ok((await read('wiki/mkdocs.yml')).includes('    - guias/comecar.md\n'), 'o nav ficou com o nome velho');
        ok((await read('wiki/docs/index.md')).includes('](guias/comecar.md)'), 'o link do index.md ficou com o nome velho');

        // Mover para a raiz das docs: o nav e os links (os dela também) acompanham
        useTestAnswers(['docs']);
        await vscode.commands.executeCommand('techdocsEditor.moveItem', docs.pageItem(file('wiki/docs/guias/comecar.md')));
        ok(await exists('wiki/docs/comecar.md'), 'o arquivo não mudou de pasta');
        ok((await read('wiki/docs/index.md')).includes('](comecar.md)'), 'o link do index.md não acompanhou a pasta');

        // Desfazer as duas
        await vscode.commands.executeCommand('techdocsEditor.undoTreeEdit');
        await vscode.commands.executeCommand('techdocsEditor.undoTreeEdit');
        ok((await exists('wiki/docs/guias/primeiros-passos.md')) && !(await exists('wiki/docs/comecar.md')) && !(await exists('wiki/docs/guias/comecar.md')), 'desfazer não voltou o arquivo');
        equal(await read('wiki/docs/index.md'), home, 'desfazer não voltou o link');

        // Nova pasta dentro da pasta clicada: index.md sem problema de formatação e a seção junto das páginas dela
        const docsFolder = docs.getChildren(siteItem(docs, 'wiki')!).find(item => item.docsRoot)!;
        const guias = docs.getChildren(docsFolder).find(item => item.kind === 'dir' && item.label === 'guias')!;
        useTestAnswers(['Rotinas']);
        await vscode.commands.executeCommand('techdocsEditor.newFolder', guias);
        equal(await read('wiki/docs/guias/rotinas/index.md'), '# Rotinas\n', 'página da pasta nova');
        ok((await read('wiki/mkdocs.yml')).includes('      - guias/primeiros-passos.md\n      - Rotinas:\n          - guias/rotinas/index.md\n'), `seção da pasta nova: ${await read('wiki/mkdocs.yml')}`);
        await vscode.commands.executeCommand('techdocsEditor.undoTreeEdit');
        ok(!(await exists('wiki/docs/guias/rotinas')), 'desfazer não tirou a pasta nova');

        // README para uma página: os links refeitos a partir do docs_dir, a imagem de fora copiada, o código pelo
        // endereço no GitHub, a página no fim do menu, o README intacto
        const readme = docs.getChildren(siteItem(docs, 'wiki')!).find(item => item.kind === 'repoFile' && item.label === 'README.md')!;
        useTestAnswers(['leia-me.md']);
        await vscode.commands.executeCommand('techdocsEditor.copyToPage', readme);
        equal(
          await read('wiki/docs/leia-me.md'),
          '# Leia-me\n\nVeja [o diagrama](assets/diagrama.png), ![o logo](assets/logo.png) e [o código](https://github.com/edtroleis/docs-editor-wiki-demo/blob/main/app/main.py).\n',
          'página copiada do README',
        );
        equal(await read('wiki/docs/assets/logo.png'), 'png', 'a imagem de fora não foi copiada');
        ok((await read('wiki/mkdocs.yml')).includes('  - leia-me.md\n'), `a página não entrou no menu: ${await read('wiki/mkdocs.yml')}`);
        ok((await read('wiki/README.md')).startsWith('# Leia-me'), 'o README mudou');
        await vscode.commands.executeCommand('techdocsEditor.undoTreeEdit');
        ok(!(await exists('wiki/docs/leia-me.md')) && !(await exists('wiki/docs/assets/logo.png')), 'desfazer não tirou a página e a imagem copiadas');
      } finally {
        useTestAnswers(undefined);
        await vscode.workspace.fs.delete(file('wiki/README.md')).then(undefined, () => undefined);
        for (const folder of ['wiki/app', 'wiki/img', 'wiki/.git']) await vscode.workspace.fs.delete(file(folder), { recursive: true }).then(undefined, () => undefined);
        await write('wiki/mkdocs.yml', yml);
        await docs.setMode('menu');
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      }
    });

    test('vários sites: um de cada vez no seletor; escolher quais aparecem, esconder; cópias e esqueletos ficam de fora', async () => {
      const { docs, sites, repoCheck, useTestSiteChoice, useTestSitePick } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const extra = ['outro-1', 'outro-2', 'outro-3', 'outro-4'];
      const ignored = ['.copia/wiki', 'app/test/fixtures/wiki', 'template/skeleton'];
      const config = () => vscode.workspace.getConfiguration('techdocsEditor');
      const roots = () => docs.getChildren().map(item => `${item.description ?? item.label} (${item.kind})`);
      const offered = () => docs.siteCandidates.map(c => c.description).sort().join(',');
      await sites.ready;
      const before = sites.all().map(s => vscode.workspace.asRelativePath(s.mkdocs.with({ path: s.site.root }), false));
      try {
        // Cópia numa pasta oculta, fixture de teste e esqueleto de template: nenhum entra
        for (const folder of ignored) await write(`${folder}/mkdocs.yml`, folder.startsWith('template') ? 'site_name: ${{ values.nome }}\n' : 'site_name: Cópia\n');
        // Gravados de novo a cada tentativa: logo depois de abrir, o observador dos mkdocs.yml pode não estar ativo
        await until(
          async () => {
            for (const folder of extra) await write(`${folder}/mkdocs.yml`, `site_name: ${folder}\n`);
            await new Promise(resolve => setTimeout(resolve, 400));
            return sites.all().map(s => s.site.root.split('/').pop());
          },
          r => r.length === before.length + extra.length,
          'os sites novos não apareceram (ou as cópias entraram)',
        );
        await until(() => docs.ready.then(offered), r => r === [...before, ...extra].sort().join(','), 'o seletor não oferece todos');

        // Trocar pelo seletor: só o site escolhido na árvore
        useTestSitePick(candidates => candidates.find(c => c.description === 'outro-2')?.key);
        await vscode.commands.executeCommand('techdocsEditor.chooseSite');
        equal(roots().join(' | '), 'outro-2 (site)', 'árvore do site escolhido');

        // Escolher quais aparecem: só a wiki e a wiki-demo
        let choices: string[] = [];
        useTestSiteChoice(items => {
          choices = items.map(item => item.path);
          return items.filter(item => item.path.startsWith('wiki'));
        });
        await vscode.commands.executeCommand('techdocsEditor.chooseSites');
        equal(choices.sort().join(','), [...before, ...extra].sort().join(','), 'sites oferecidos');
        equal(JSON.stringify(config().get('sites')), JSON.stringify(['wiki', 'wiki-demo']), 'escolha gravada');
        await until(() => docs.ready.then(offered), r => r === 'wiki,wiki-demo', 'seletor com os escolhidos');
        equal((await repoCheck.check(true)).length, 2, 'a verificação conferiu os escondidos');

        // Esconder a wiki-demo pelo menu do site
        const demo = await until(() => siteItem(docs, 'wiki-demo'), Boolean, 'wiki-demo não entrou na árvore');
        await vscode.commands.executeCommand('techdocsEditor.hideSite', demo);
        equal(JSON.stringify(config().get('sites')), JSON.stringify(['wiki']), 'esconder não tirou da escolha');

        // Marcar todos: todos de volta
        useTestSiteChoice(items => items);
        await vscode.commands.executeCommand('techdocsEditor.chooseSites');
        await until(() => docs.ready.then(offered), r => r === [...before, ...extra].sort().join(','), 'todos os sites de volta');
      } finally {
        useTestSiteChoice(undefined);
        useTestSitePick(undefined);
        await config().update('sites', undefined, vscode.ConfigurationTarget.Workspace);
        for (const folder of [...extra, '.copia', 'app', 'template']) await vscode.workspace.fs.delete(file(folder), { recursive: true }).then(undefined, () => undefined);
      }
      await until(() => sites.all().length, n => n === before.length, 'os sites de teste continuaram');
    });

    test('abrir uma página de outro site troca o site da árvore', async () => {
      const { docs } = await api();
      await until(() => siteItem(docs, 'wiki'), Boolean, 'wiki não entrou na árvore');
      await vscode.window.showTextDocument(file('wiki-demo/docs/index.md'));
      await until(
        () => docs.ready.then(() => docs.getChildren().map(item => item.description).join()),
        r => r === 'wiki-demo',
        'a árvore não seguiu a página aberta',
      );
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('pastas sem documentação: repositórios Git e pastas vazias, sem entrar nos sites nem nos repositórios', async () => {
      const { docs } = await api();
      await docs.ready;
      await vscode.workspace.fs.createDirectory(file('vazia'));
      await vscode.workspace.fs.writeFile(file('repo-sem-docs/.git/HEAD'), new TextEncoder().encode('ref: refs/heads/main\n'));
      await vscode.workspace.fs.writeFile(file('repo-sem-docs/vazia-dentro/.keep'), new Uint8Array());
      try {
        const found = (await foldersWithoutDocs(docs.siteCandidates)).map(uri => vscode.workspace.asRelativePath(uri, false));
        ok(found.includes('vazia') && found.includes('repo-sem-docs'), `pastas achadas: ${found.join(', ')}`);
        ok(!found.some(path => path.startsWith('wiki') || path.includes('vazia-dentro')), `entrou num site ou num repositório: ${found.join(', ')}`);
      } finally {
        for (const folder of ['vazia', 'repo-sem-docs']) await vscode.workspace.fs.delete(file(folder), { recursive: true }).then(undefined, () => undefined);
      }
    });

    test('pasta sem documentação na árvore: "Criar a documentação" cria num clique e a árvore passa ao site', async () => {
      const { docs, sites } = await api();
      await docs.ready;
      const before = docs.current;
      const read = async (path: string) => new TextDecoder().decode(await vscode.workspace.fs.readFile(file(path)));
      const exists = (path: string) => Promise.resolve(vscode.workspace.fs.stat(file(path))).then(() => true, () => false);
      await vscode.workspace.fs.createDirectory(file('pasta-vazia'));
      try {
        await docs.selectFolder(file('pasta-vazia'));
        equal(docs.folderWithoutDocs?.path, file('pasta-vazia').path, 'a pasta não virou a atual');
        equal(docs.getChildren().length, 0, 'a árvore mostrou um site');
        await vscode.commands.executeCommand('techdocsEditor.createHere');
        await until(() => sites.all().some(s => s.mkdocs.path.endsWith('/pasta-vazia/mkdocs.yml')), Boolean, 'o site não foi criado');
        ok((await read('pasta-vazia/mkdocs.yml')).startsWith('site_name: Pasta vazia\n'), `mkdocs.yml: ${await read('pasta-vazia/mkdocs.yml')}`);
        ok(await exists('pasta-vazia/docs/index.md'), 'sem a página inicial');
        ok(!(await exists('pasta-vazia/catalog-info.yaml')), 'criou o catalog-info.yaml');
        await until(() => [docs.current, docs.folderWithoutDocs] as const, ([key, folder]) => Boolean(key?.endsWith('/pasta-vazia/mkdocs.yml')) && !folder, 'a árvore não passou ao site novo');
        // Apagar o site mostrado: a árvore volta à pasta, com a tela de criar
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.workspace.fs.delete(file('pasta-vazia/mkdocs.yml'));
        await vscode.workspace.fs.delete(file('pasta-vazia/docs'), { recursive: true });
        await until(() => docs.folderWithoutDocs?.path, path => path === file('pasta-vazia').path, 'apagar o site não levou à tela de criar');
      } finally {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.workspace.fs.delete(file('pasta-vazia'), { recursive: true }).then(undefined, () => undefined);
        await until(() => sites.all().some(s => s.mkdocs.path.endsWith('/pasta-vazia/mkdocs.yml')), found => !found, 'o site apagado continuou');
        if (before) await docs.select(before);
      }
    });

    test('a busca vai até 2 pastas abaixo do workspace; os sites mais fundos entram ao abrir uma página ou entrar na pasta', async () => {
      const { sites } = await api();
      await sites.ready;
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const remove = (path: string) => vscode.workspace.fs.delete(file(path), { recursive: true }).then(undefined, () => undefined);
      const has = (path: string) => sites.all().some(s => s.mkdocs.path.endsWith(`/${path}`));
      try {
        await write('fundo/a/b/docs/index.md', '# Fundo\n');
        await write('fundo/a/b/mkdocs.yml', 'site_name: Fundo\n');
        await write('pasta/x/y/z/mkdocs.yml', 'site_name: Pasta\n');
        await write('pasta/x/y/z/w/v/mkdocs.yml', 'site_name: Mais fundo\n');
        // O observador ativo: um site a 2 pastas entra (gravado de novo a cada tentativa, como a sonda abaixo)
        let probe = 0;
        await until(
          async () => {
            await write('raso/x/mkdocs.yml', `site_name: Raso ${++probe}\n`);
            await new Promise(resolve => setTimeout(resolve, 400));
            return has('raso/x/mkdocs.yml');
          },
          Boolean,
          'o site a 2 pastas não entrou',
        );
        ok(!has('fundo/a/b/mkdocs.yml'), 'o site a 3 pastas entrou na busca');

        await vscode.workspace.openTextDocument(file('fundo/a/b/docs/index.md'));
        await until(() => has('fundo/a/b/mkdocs.yml'), Boolean, 'abrir a página não trouxe o site');
        ok(sites.siteOf(file('fundo/a/b/docs/index.md')), 'a página aberta não é do site');

        await sites.discover(file('pasta/x'));
        ok(has('pasta/x/y/z/mkdocs.yml'), 'entrar na pasta não trouxe o site 2 pastas abaixo dela');
        ok(!has('pasta/x/y/z/w/v/mkdocs.yml'), 'entrar na pasta trouxe o site 4 pastas abaixo dela');
      } finally {
        await Promise.all(['fundo', 'pasta', 'raso'].map(remove));
        await until(() => has('fundo/a/b/mkdocs.yml') || has('pasta/x/y/z/mkdocs.yml') || has('raso/x/mkdocs.yml'), found => !found, 'os sites de teste ficaram');
      }
    });

    test('sem mkdocs.yml: README, docs/ ou catalog-info.yaml ligam a tela "Preparar"; o site criado a desliga', async () => {
      const { prepare, sites, docs } = await api();
      await prepare.ready;
      equal(prepare.active, false, 'com site, a tela de preparar apareceu');
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const remove = (path: string) => vscode.workspace.fs.delete(file(path), { recursive: true }).then(undefined, () => undefined);
      // Apagar antes de o observador dos mkdocs.yml estar ativo deixava os sites na lista: espera ele ver um site
      // novo (gravado de novo a cada tentativa, porque o aviso dado antes de ele estar ativo se perde) e a remoção dele
      const count = sites.list().length;
      let probe = 0;
      await until(
        async () => {
          await write('sonda/mkdocs.yml', `site_name: Sonda ${++probe}\n`);
          await new Promise(resolve => setTimeout(resolve, 400));
          return sites.list().length;
        },
        n => n === count + 1,
        'o site de sonda não apareceu',
      );
      await remove('sonda');
      await until(() => sites.list().length, n => n === count, 'o site de sonda continuou');
      const mkdocs = sites.list().map(s => s.mkdocs);
      const saved = await Promise.all(mkdocs.map(uri => vscode.workspace.fs.readFile(uri)));
      try {
        for (const uri of mkdocs) await vscode.workspace.fs.delete(uri);
        await until(() => sites.list().length, count => count === 0, 'os sites continuaram depois de apagar os mkdocs.yml');
        // Sem nada do que se procura na raiz (as páginas das wikis não estão em docs/): nada aparece
        await new Promise(resolve => setTimeout(resolve, 1_000));
        equal(prepare.active, false, 'sem README, docs/ nem catalog-info.yaml, a tela apareceu');
        // O ícone continua (BL7): a seção Documentação abre com a tela "Criar a documentação"
        await vscode.commands.executeCommand('workbench.view.extension.techdocs');
        await until(() => docs.visible, Boolean, 'sem nada no workspace, a seção Documentação não abriu');

        await write('README.md', '# Repositório\n');
        await until(() => prepare.active && prepare.found.readme, Boolean, 'o README.md não ligou a tela');
        await remove('README.md');
        await until(() => prepare.active, active => !active, 'sem o README.md, a tela continuou');

        await write('docs/guia.md', '# Guia\n');
        await until(() => prepare.active && prepare.found.docs, Boolean, 'a pasta docs/ não ligou a tela');
        await remove('docs/guia.md');
        await remove('docs');
        await until(() => prepare.active, active => !active, 'sem a pasta docs/, a tela continuou');

        await write('catalog-info.yaml', 'kind: Component\n');
        await until(() => prepare.active && prepare.found.catalog, Boolean, 'o catalog-info.yaml não ligou a tela');
        // Com o site de volta, a árvore toma o lugar da tela
        for (const [i, uri] of mkdocs.entries()) await vscode.workspace.fs.writeFile(uri, saved[i]);
        await until(() => prepare.active, active => !active, 'com o site criado, a tela continuou');
      } finally {
        await remove('README.md');
        await remove('docs');
        await remove('catalog-info.yaml');
        for (const [i, uri] of mkdocs.entries()) await vscode.workspace.fs.writeFile(uri, saved[i]);
      }
      await until(() => sites.list().length, count => count === mkdocs.length, 'os sites não voltaram');
    });
  });

  suite('Templates', function () {
    this.timeout(60_000);
    const file = (path: string) => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path);
    const read = async (path: string) => new TextDecoder().decode(await vscode.workspace.fs.readFile(file(path)));
    const remove = (path: string) => vscode.workspace.fs.delete(file(path), { recursive: true }).then(undefined, () => undefined);

    teardown(closeAll);

    test('nova página: campos preenchidos, gravada no docs_dir e aberta no editor visual', async () => {
      const { newPage, provider } = await api();
      try {
        const uri = await newPage.run(file('wiki/docs/guias/imagens.md'), {
          template: 'runbook',
          title: 'Latência alta no checkout',
          values: { alert: 'HighLatency', owner: 'time-checkout' },
        });
        equal(uri?.toString(), file('wiki/docs/guias/latencia-alta-no-checkout.md').toString(), 'arquivo na pasta da página clicada');
        const text = await read('wiki/docs/guias/latencia-alta-no-checkout.md');
        ok(text.startsWith('# Latência alta no checkout\n'), `título: ${text.slice(0, 60)}`);
        ok(/HighLatency/.test(text) && /time-checkout/.test(text), 'campos preenchidos');
        ok(!text.includes('{{') && !text.includes('template:'), 'sobrou marcação do template');
        // TP7: o primeiro trecho a preencher vem selecionado; digitar troca o texto de exemplo
        const fill = firstToFill(text);
        ok(fill, 'runbook sem trecho a preencher');
        const session = await provider.session(uri!);
        session.insert('Clientes não conseguem pagar.');
        const saved = await until(() => session.saved(), t => t !== text, 'o texto digitado não chegou');
        equal(saved, text.replace(fill!, 'Clientes não conseguem pagar.'), 'texto digitado no lugar do exemplo');
      } finally {
        await remove('wiki/docs/guias/latencia-alta-no-checkout.md');
      }
    });

    test('templates da extensão na língua do site, não na do VS Code', async () => {
      const { newPage } = await api();
      try {
        // VS Code em inglês, wiki com theme.language: pt-BR (o caso pelo texto do README está nos testes do core)
        equal(vscode.env.language, 'en', 'os testes rodam com o VS Code em inglês');
        await newPage.run(file('wiki/docs'), { template: 'guide', title: 'Fazer deploy', path: 'fazer-deploy.md', values: { owner: 'time' } });
        const text = await read('wiki/docs/fazer-deploy.md');
        ok(text.includes('## Objetivo'), `template em inglês num site em português:\n${text.slice(0, 200)}`);
      } finally {
        await remove('wiki/docs/fazer-deploy.md');
      }
    });

    test('ADR na pasta do template, numerado; arquivo existente não é sobrescrito', async () => {
      const { newPage } = await api();
      try {
        const values = { status: 'Proposed', owner: 'time' };
        const first = await newPage.run(file('wiki/docs'), { template: 'adr', title: 'Usar PostgreSQL', values });
        ok(first?.path.endsWith('/wiki/docs/adr/0001-usar-postgresql.md'), `primeiro ADR: ${first?.path}`);
        await closeAll();
        const second = await newPage.run(file('wiki/docs'), { template: 'adr', title: 'Usar filas', values });
        ok(second?.path.endsWith('/adr/0002-usar-filas.md'), `segundo ADR: ${second?.path}`);
        await closeAll();
        const before = await read(vscode.workspace.asRelativePath(first!));
        const again = await newPage.run(file('wiki/docs'), { template: 'wiki-page', title: 'X', path: 'adr/0001-usar-postgresql.md' });
        equal(again, undefined, 'criou por cima de um arquivo existente');
        equal(await read(vscode.workspace.asRelativePath(first!)), before, 'o arquivo existente mudou');
        equal(await newPage.run(file('wiki/docs'), { template: 'wiki-page', title: 'X', path: '../fora.md' }), undefined, 'saiu do docs_dir');
      } finally {
        await remove('wiki/docs/adr');
      }
    });

    test('templates do repositório: o do site vale mais que o do workspace, que sobrepõe o da extensão; builtIn: false', async () => {
      const { newPage } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const template = (name: string, body: string) =>
        `---\ntemplate:\n  name: ${name}\n  category: guide\n---\n\n# {{title}}\n\n${body}\n`;
      const config = vscode.workspace.getConfiguration('techdocsEditor.templates');
      await write('.techdocs/templates/runbook.md', template('Runbook da empresa', 'Do workspace.'));
      await write('.techdocs/templates/so-workspace.md', template('Só do workspace', 'Workspace.'));
      await write('.techdocs/templates/README.md', '# Templates da empresa\n');
      await write('wiki/.techdocs/templates/so-workspace.md', template('Do site', 'Do site.'));
      try {
        const runbook = await newPage.run(file('wiki/docs'), { template: 'runbook', title: 'Disco cheio', path: 'disco-cheio.md' });
        equal(await read('wiki/docs/disco-cheio.md'), '# Disco cheio\n\nDo workspace.\n', 'runbook do workspace sobrepõe o da extensão');
        await closeAll();
        await newPage.run(runbook!, { template: 'so-workspace', title: 'Local', path: 'local.md' });
        equal(await read('wiki/docs/local.md'), '# Local\n\nDo site.\n', 'o do site vale mais que o do workspace');
        await closeAll();
        equal(await newPage.run(file('wiki/docs'), { template: 'README', title: 'X', path: 'x.md' }), undefined, 'README sem bloco template virou template');

        await config.update('builtIn', false, vscode.ConfigurationTarget.Workspace);
        equal(await newPage.run(file('wiki/docs'), { template: 'adr', title: 'Y', path: 'y.md' }), undefined, 'template da extensão com builtIn: false');
        ok(await newPage.run(file('wiki/docs'), { template: 'runbook', title: 'Z', path: 'z.md' }), 'o do repositório sumiu com builtIn: false');
        const blank = await newPage.run(file('wiki/docs'), { template: 'blank', title: 'Colada', path: 'colada.md', nav: false });
        equal(blank && (await read('wiki/docs/colada.md')), '# Colada\n', 'página em branco com builtIn: false');
      } finally {
        await config.update('builtIn', undefined, vscode.ConfigurationTarget.Workspace);
        for (const path of ['.techdocs', 'wiki/.techdocs', 'wiki/docs/disco-cheio.md', 'wiki/docs/local.md', 'wiki/docs/z.md', 'wiki/docs/colada.md']) await remove(path);
      }
    });

    test('novo site: mkdocs.yml com nav e techdocs-core, páginas no docs/, site reconhecido e anotação do catalog-info.yaml', async () => {
      const { newSite, sites, docs } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      await write('catalog-info.yaml', 'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: pag\nspec:\n  owner: time-pag\n');
      try {
        const result = await newSite.run(undefined, { template: 'service-docs', folder: file('site-novo'), values: { site_name: 'Pagamentos' } });
        ok(result?.mkdocs.path.endsWith('/site-novo/mkdocs.yml'), `mkdocs.yml: ${result?.mkdocs.path}`);
        equal(result?.annotation, 'backstage.io/techdocs-ref: dir:./site-novo', 'anotação relativa ao catalog-info.yaml da raiz');
        const yml = await read('site-novo/mkdocs.yml');
        ok(yml.startsWith('site_name: Pagamentos\nnav:\n'), `mkdocs.yml: ${yml}`);
        ok(/plugins:\n {2}- techdocs-core\n/.test(yml), `sem techdocs-core: ${yml}`);
        const home = await read('site-novo/docs/index.md');
        ok(home.startsWith('# Pagamentos\n') && home.includes('time-pag') && !home.includes('{{'), `index.md: ${home.slice(0, 120)}`);
        ok((await read('site-novo/docs/adr/0001-record-architecture-decisions.md')).includes('Status: Accepted'), 'primeiro ADR');
        await until(() => sites.list().some(s => s.mkdocs.path.endsWith('/site-novo/mkdocs.yml')), Boolean, 'site novo não reconhecido');
        const site = await until(
          async () => {
            await docs.ready;
            return siteItem(docs, 'site-novo');
          },
          Boolean,
          'site novo não apareceu na árvore',
        );
        const labels = docs.getChildren(site!).map(item => item.label);
        equal(labels.join(', '), 'Pagamentos, Architecture, Operations and support, Decisions', 'árvore pelo nav');
        equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'index.md', 'a primeira página abre');

        // Nunca por cima: mkdocs.yml na pasta ou uma página do site já existente
        equal(await newSite.run(undefined, { template: 'team-wiki', folder: file('site-novo'), values: { site_name: 'X' } }), undefined, 'criou onde já há mkdocs.yml');
        await write('outro/docs/index.md', '# Minha\n');
        equal(await newSite.run(undefined, { template: 'team-wiki', folder: file('outro'), values: { site_name: 'X', owner: 'y' } }), undefined, 'sobrescreveu docs/index.md');
        equal(await read('outro/docs/index.md'), '# Minha\n', 'a página existente mudou');
        ok(!(await vscode.workspace.fs.stat(file('outro/mkdocs.yml')).then(() => true, () => false)), 'criou o mkdocs.yml mesmo recusando');
      } finally {
        for (const path of ['catalog-info.yaml', 'site-novo', 'outro']) await remove(path);
      }
    });

    test('template de site do repositório: arquivos da pasta dele, página do template do repositório e campo do site', async () => {
      const { newSite } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      await write(
        '.techdocs/templates/plataforma/template.yml',
        'name: Site da plataforma\nfields:\n  squad:\n    prompt: Squad\nfiles:\n  - path: index.md\n    title: Início\n    source: inicio.md\n  - path: guias/deploy.md\n    title: Deploy\n    section: Guias\n    page: guide\n',
      );
      await write('.techdocs/templates/plataforma/inicio.md', '# {{site_name}}\n\nSquad {{squad}}.\n');
      await write('.techdocs/templates/guide.md', '---\ntemplate:\n  name: Guia da empresa\n  category: guide\n---\n\n# {{title}}\n\nDo repositório.\n');
      try {
        const result = await newSite.run(file('site-repo'), { template: 'plataforma', values: { site_name: 'Plataforma', squad: 'Alfa' } });
        equal(result?.annotation, 'backstage.io/techdocs-ref: dir:.', 'sem catalog-info.yaml: a anotação para o da própria pasta');
        equal(await read('site-repo/docs/index.md'), '# Plataforma\n\nSquad Alfa.\n', 'arquivo da pasta do template');
        equal(await read('site-repo/docs/guias/deploy.md'), '# Deploy\n\nDo repositório.\n', 'template de página do repositório');
        equal(
          await read('site-repo/mkdocs.yml'),
          'site_name: Plataforma\nnav:\n  - Início: index.md\n  - Guias:\n      - Deploy: guias/deploy.md\nplugins:\n  - techdocs-core\n',
          'mkdocs.yml',
        );
      } finally {
        for (const path of ['.techdocs', 'site-repo']) await remove(path);
      }
    });

    test('adotar a docs/ que já existe: só o mkdocs.yml, com o nav pelas pastas e títulos; nenhuma página muda', async () => {
      const { newSite } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const pages: Record<string, string> = {
        'adotar/docs/index.md': '# Pagamentos\n\nComeço.\n',
        'adotar/docs/arquitetura.md': '# Arquitetura\n',
        'adotar/docs/guias/deploy.md': '# Deploy\n',
      };
      for (const [path, text] of Object.entries(pages)) await write(path, text);
      try {
        const result = await newSite.run(undefined, { folder: file('adotar'), adopt: true, values: { site_name: 'Pagamentos' } });
        ok(result?.mkdocs.path.endsWith('/adotar/mkdocs.yml'), `mkdocs.yml: ${result?.mkdocs.path}`);
        equal(
          await read('adotar/mkdocs.yml'),
          'site_name: Pagamentos\nnav:\n  - Pagamentos: index.md\n  - Arquitetura: arquitetura.md\n  - Guias:\n      - Deploy: guias/deploy.md\nplugins:\n  - techdocs-core\n',
          'mkdocs.yml',
        );
        for (const [path, text] of Object.entries(pages)) equal(await read(path), text, `${path} mudou`);
        equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'index.md', 'a página inicial abre');
      } finally {
        await remove('adotar');
      }
    });

    test('README.md como página inicial: copiado (o README fica) ou movido (o README vira um link para as docs)', async () => {
      const { newSite } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const readme = '# Pagamentos\n\nVeja o [deploy](docs/deploy.md) e o [código](src/main.ts).\n';
      await write('com-readme/README.md', readme);
      await write('move-readme/README.md', readme);
      try {
        ok(await newSite.run(undefined, { template: 'service-docs', folder: file('com-readme'), values: { site_name: 'Pagamentos', owner: 'time-pag' }, readme: 'copy' }), 'não criou (copiar)');
        equal(await read('com-readme/docs/index.md'), '# Pagamentos\n\nVeja o [deploy](deploy.md) e o código (`src/main.ts`).\n', 'página inicial do README');
        equal(await read('com-readme/README.md'), readme, 'copiar mudou o README');
        ok((await read('com-readme/docs/architecture.md')).startsWith('# Architecture\n'), 'as outras páginas do template continuam');

        ok(await newSite.run(undefined, { template: 'service-docs', folder: file('move-readme'), values: { site_name: 'Pagamentos', owner: 'time-pag' }, readme: 'move' }), 'não criou (mover)');
        ok((await read('move-readme/docs/index.md')).includes('[deploy](deploy.md)'), 'página inicial do README');
        const pointer = await read('move-readme/README.md');
        ok(pointer.startsWith('# Pagamentos\n\n') && pointer.includes('(docs/index.md)') && !pointer.includes('src/main.ts'), `README movido: ${pointer}`);
      } finally {
        for (const path of ['com-readme', 'move-readme']) await remove(path);
      }
    });

    test('prévia: sugere nome e dono, desmarca, renomeia, acrescenta e só grava no Criar', async () => {
      const { preview, sites } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const exists = (path: string) => vscode.workspace.fs.stat(file(path)).then(() => true, () => false);
      await write('previa/README.md', '# Pagamentos\n\nServiço de cobrança.\n');
      await write('previa/CODEOWNERS', '* @acme/time-pagamentos\n');
      try {
        await preview.open(file('previa'));
        // Sem templates no repositório: começa pelo em branco (só a página inicial)
        const blank = await until(() => preview.current, p => Boolean(p?.files.some(f => f.origin === 'template')), 'prévia sem as páginas do template');
        equal(blank!.files.filter(f => f.origin === 'template').map(f => f.path).join(), 'docs/index.md', 'o padrão não é o em branco');
        await preview.send({ type: 'set', field: 'template', value: 'golden-path' });
        const plan = await until(() => preview.current, p => (p?.files.filter(f => f.origin === 'template').length ?? 0) > 1, 'prévia sem as páginas do golden path');
        const view = (preview as unknown as { state(): { view: { siteName: string; owner: string; ownerFrom?: string } } }).state().view;
        equal(view.siteName, 'Pagamentos', 'nome do título do README');
        equal(`${view.owner} (${view.ownerFrom})`, 'time-pagamentos (CODEOWNERS)', 'dono do CODEOWNERS');
        // O catalog-info.yaml começa desmarcado mesmo com o dono achado: marcá-lo grava com o dono
        ok(plan!.files.some(f => f.path === 'catalog-info.yaml' && !f.included), 'catalog-info.yaml marcado de início');
        await preview.send({ type: 'toggle', path: 'catalog-info.yaml', on: true });
        ok(plan!.files.some(f => f.path === '.markdownlint.yaml' && f.included), 'sem .markdownlint.yaml na prévia (o repositório não tem um)');
        ok(!(await exists('previa/mkdocs.yml')), 'gravou antes do Criar');

        const optional = plan!.files.find(f => f.origin === 'template' && f.optional && !f.path.endsWith('index.md'))!;
        await preview.send({ type: 'toggle', path: optional.path, on: false });
        await preview.send({ type: 'rename', key: 'index.md', title: 'Início' });
        await preview.send({ type: 'add', text: 'guias/deploy', by: 'path' });
        await preview.send({ type: 'set', field: 'readme', value: 'move' });
        await preview.send({ type: 'create' });

        const yml = await read('previa/mkdocs.yml');
        ok(yml.startsWith('site_name: Pagamentos\n') && yml.includes('Início: index.md') && yml.includes('deploy.md'), `mkdocs.yml: ${yml}`);
        ok(!(await exists(`previa/${optional.path}`)), `criou ${optional.path} desmarcado`);
        ok(await exists('previa/docs/guias/deploy.md'), 'página acrescentada');
        equal(await read('previa/docs/index.md'), '# Pagamentos\n\nServiço de cobrança.\n', 'página inicial do README');
        ok((await read('previa/README.md')).includes('(docs/index.md)'), 'README movido não virou link');
        ok((await read('previa/catalog-info.yaml')).includes('owner: time-pagamentos'), 'catalog-info.yaml sem o dono');
        ok((await read('previa/.markdownlint.yaml')).includes('MD013: false'), '.markdownlint.yaml não foi para a pasta do site');
        equal(preview.current, undefined, 'a prévia não fechou');
        await until(() => sites.list().some(s => s.mkdocs.path.endsWith('/previa/mkdocs.yml')), Boolean, 'site novo não reconhecido');
      } finally {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await remove('previa');
      }
    });

    test('prévia: catalog-info.yaml começa desmarcado, continua ao trocar de template e ao preencher o dono', async () => {
      const { preview } = await api();
      await vscode.workspace.fs.writeFile(file('sem-dono/README.md'), new TextEncoder().encode('# Sem dono\n\nPagamentos do time, por cartão e Pix.\n'));
      try {
        await preview.open(file('sem-dono'));
        const catalog = () => preview.current?.files.find(f => f.path === 'catalog-info.yaml');
        await until(catalog, Boolean, 'prévia sem o catalog-info.yaml');
        equal(catalog()!.included, false, 'catalog-info.yaml marcado sem dono');
        await preview.send({ type: 'set', field: 'template', value: 'golden-path' });
        await until(() => preview.current, p => (p?.files.filter(f => f.origin === 'template').length ?? 0) > 1, 'prévia sem as páginas do golden path');
        equal(catalog()!.included, false, 'trocar de template marcou o catalog-info.yaml');
        // Preencher o dono não marca o arquivo (o dono serve também aos templates de página); marcado, o componente
        // leva o nome, o título e a descrição do README
        await preview.send({ type: 'set', field: 'owner', value: 'time-pagamentos' });
        equal(catalog()!.included, false, 'preencher o dono marcou o catalog-info.yaml');
        await preview.send({ type: 'toggle', path: 'catalog-info.yaml', on: true });
        await until(catalog, f => f!.included, 'marcar não incluiu o catalog-info.yaml');
        const metadata = (yaml: string) => yaml.slice(yaml.indexOf('metadata:'), yaml.indexOf('  annotations:'));
        equal(
          metadata(catalog()!.content!),
          'metadata:\n  name: sem-dono\n  title: Sem dono\n  description: Pagamentos do time, por cartão e Pix.\n',
          'metadata do catalog-info.yaml',
        );
        await preview.send({ type: 'set', field: 'siteName', value: 'Tarefas API' });
        await until(catalog, f => metadata(f!.content!).includes('name: tarefas-api\n  title: Tarefas API\n'), 'o nome do componente não seguiu o do site');
        // Desmarcado à mão, continua desmarcado mesmo mudando o dono
        await preview.send({ type: 'toggle', path: 'catalog-info.yaml', on: false });
        await preview.send({ type: 'set', field: 'owner', value: 'outro-time' });
        equal(catalog()!.included, false, 'mudar o dono marcou o arquivo desmarcado à mão');
      } finally {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await remove('sem-dono');
      }
    });

    test('no fim, sem catalog-info.yaml: não pergunta nada; com catalog: off no repositório, sem anotação a sugerir', async () => {
      const { newSite } = await api();
      await vscode.workspace.fs.writeFile(file('catalogo/docs/index.md'), new TextEncoder().encode('# Catálogo\n'));
      // Outro repositório com catalog-info.yaml (Backstage no workspace): antes, aqui vinha a pergunta
      await vscode.workspace.fs.writeFile(file('catalogo-outro/catalog-info.yaml'), new TextEncoder().encode('kind: Component\n'));
      try {
        const result = await newSite.run(undefined, { folder: file('catalogo'), adopt: true, values: { site_name: 'Catálogo' } });
        ok(result?.annotation, 'sem a anotação a sugerir');
        ok(!(await read('catalogo/.techdocs-editor.yaml').then(() => true, () => false)), 'gravou o .techdocs-editor.yaml sem perguntar');
        // A pasta sem Git: o .techdocs-editor.yaml dela vale para o site
        await remove('catalogo/mkdocs.yml');
        await vscode.workspace.fs.writeFile(file('catalogo/.techdocs-editor.yaml'), new TextEncoder().encode('catalog: off\n'));
        const off = await newSite.run(undefined, { folder: file('catalogo'), adopt: true, values: { site_name: 'Catálogo' } });
        ok(off, 'não criou');
        equal(off!.annotation, undefined, 'com catalog: off, não há anotação a sugerir');
      } finally {
        await remove('catalogo');
        await remove('catalogo-outro');
      }
    });

    test('conferir: achados no painel Problemas; preparar: aplica as correções e sobra o que precisa de uma pessoa', async () => {
      const { repoCheck, sites, checkView } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const yml = 'site_name: Conferir\nnav:\n  - Início: index.md\n  - Sumiu: sumiu.md\nplugins:\n  - search\n';
      await write('check-site/docs/index.md', '# Conferir\n\nVeja [a outra](nada.md) e a [fora](fora.md).\n');
      await write('check-site/docs/fora.md', '# Fora\n');
      await write('check-site/mkdocs.yml', yml);
      try {
        await until(() => sites.list().some(s => s.mkdocs.path.endsWith('/check-site/mkdocs.yml')), Boolean, 'site não reconhecido');
        const result = (await repoCheck.check(true)).find(r => r.mkdocs.path.endsWith('/check-site/mkdocs.yml'));
        const codes = result!.findings.map(f => f.code).join(', ');
        for (const code of ['techdocs-plugin-missing', 'nav-page-missing', 'broken-link', 'page-not-in-nav']) {
          ok(codes.includes(code), `faltou ${code}: ${codes}`);
        }
        const problems = vscode.languages.getDiagnostics(file('check-site/mkdocs.yml'));
        ok(problems.some(d => d.code === 'nav-page-missing' && d.range.start.line === 3), `painel Problemas: ${problems.map(d => `${d.code}@${d.range.start.line}`)}`);
        ok(vscode.languages.getDiagnostics(file('check-site/docs/index.md')).some(d => d.code === 'broken-link'), 'link quebrado no painel');
        // Seção Verificação: um nó por site (há vários no workspace), com os grupos por tipo
        const groups = () => {
          const site = checkView.getChildren().find(item => item.label === 'check-site/mkdocs.yml');
          return site ? checkView.getChildren(site).map(item => item.label) : [];
        };
        ok(groups().includes('Nav points to missing pages') && groups().includes('Broken links'), `Verificação: ${groups()}`);

        // Sem o arquivo de regras na raiz do workspace, para não mexer nos outros testes
        const applied = await repoCheck.prepare(file('check-site'), { apply: f => f.code !== 'lint-config-missing' });
        equal(applied, 3, 'correções aplicadas: plugin, página do nav e página fora do nav');
        equal(
          await read('check-site/mkdocs.yml'),
          'site_name: Conferir\nnav:\n  - Início: index.md\n  - Sumiu: sumiu.md\n  - fora.md\nplugins:\n  - techdocs-core\n  - search\n',
          'mkdocs.yml',
        );
        equal(await read('check-site/docs/sumiu.md'), '# Sumiu\n', 'página do nav criada');
        const left = vscode.languages.getDiagnostics(file('check-site/mkdocs.yml')).map(d => d.code).sort();
        ok(!left.includes('techdocs-plugin-missing') && !left.includes('nav-page-missing'), `o painel não foi atualizado: ${left}`);
        ok(!groups().includes('Nav points to missing pages') && groups().includes('Broken links'), `Verificação depois de preparar: ${groups()}`);
        ok(vscode.languages.getDiagnostics(file('check-site/docs/index.md')).some(d => d.code === 'broken-link'), 'o link quebrado (sem correção) sumiu');
      } finally {
        await remove('check-site');
      }
    });

    test('opções da verificação: catalog-info.yaml por modo, para o time ou só para mim', async () => {
      const { repoCheck, catalogOptions } = await api();
      const config = () => vscode.workspace.getConfiguration('techdocsEditor');
      const catalogFindings = async () =>
        (await repoCheck.check(true)).find(r => r.mkdocs.path.endsWith('/wiki/mkdocs.yml'))!.findings.filter(f => f.code.startsWith('catalog-'));
      // A pasta aberta é o repositório do site (o .techdocs-editor.yaml da raiz vale para ele)
      await vscode.workspace.fs.createDirectory(file('.git'));
      try {
        // Padrão (auto): sem o arquivo e sem outro catalog-info.yaml no workspace (sem Backstage), nada
        equal((await catalogFindings()).length, 0, 'modo auto sem sinal de Backstage');
        // Com o de outro repositório no workspace, só uma dica
        await vscode.workspace.fs.writeFile(file('outro-repo/catalog-info.yaml'), new TextEncoder().encode('kind: Component\n'));
        equal((await catalogFindings()).map(f => `${f.code}:${f.severity}`).join(), 'catalog-missing:hint', 'modo auto');
        // Só para mim: a configuração do VS Code
        equal(await catalogOptions.choose(undefined, { mode: 'off', scope: 'me' }), 'off', 'escolha só para mim');
        equal(config().inspect('catalog')?.globalValue, 'off', 'configuração do usuário');
        equal((await catalogFindings()).length, 0, 'modo off: nada sobre o catálogo');
        // Para o time: o .techdocs-editor.yaml, que vence a configuração
        equal(await catalogOptions.choose(undefined, { mode: 'required', scope: 'team' }), 'required', 'escolha para o time');
        equal(await read('.techdocs-editor.yaml'), 'catalog: required\n', '.techdocs-editor.yaml');
        const [missing] = await catalogFindings();
        equal(`${missing?.code}:${missing?.severity}:${Boolean(missing?.fix)}`, 'catalog-missing:warning:true', 'modo required');
        // A correção cria o esqueleto na raiz do repositório, apontando para o site
        await repoCheck.prepare(file('wiki'), { apply: f => f.code === 'catalog-missing' });
        const created = await read('catalog-info.yaml');
        ok(created.includes('kind: Component') && created.includes('backstage.io/techdocs-ref: dir:./wiki'), `catalog-info.yaml: ${created}`);
      } finally {
        await config().update('catalog', undefined, vscode.ConfigurationTarget.Global);
        for (const path of ['.techdocs-editor.yaml', 'catalog-info.yaml', 'outro-repo', '.git']) await remove(path);
      }
    });

    test('templates da empresa (TA3): lidos do GitHub com login, guardados por uma hora e usados sem rede', async () => {
      const { newPage, newSite, publish, central } = await api();
      const config = vscode.workspace.getConfiguration('techdocsEditor.templates');
      const page = '---\ntemplate:\n  name: Runbook da empresa\n  category: guide\n---\n\n# {{title}}\n\nDa empresa.\n';
      const site = 'name: Site da empresa\nfiles:\n  - path: index.md\n    title: Início\n    source: inicio.md\n  - path: rb.md\n    title: Runbook\n    page: runbook\n';
      const files: Record<string, string> = {
        'templates/runbook.md': page,
        'templates/site-empresa/template.yml': site,
        'templates/site-empresa/inicio.md': '# {{site_name}}\n',
      };
      // GitHub simulado mínimo (o FakeGitHub do core usa node:crypto, que a suíte web não tem): repositório privado
      const calls: string[] = [];
      let offline = false;
      // Commit novo a cada execução: a cópia de uma execução anterior (no perfil dos testes) não serve
      const commit = `c${Date.now()}`;
      const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
      const fetchFake = async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname.replace('/repos/acme/tpl', '');
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        calls.push(`${auth ? 'login' : 'anon'} ${path}`);
        if (offline) throw new TypeError('fetch failed');
        if (!auth) return reply(404, { message: 'Not Found' });
        if (path === '') return reply(200, { default_branch: 'main', permissions: {} });
        if (path === '/commits/main') return reply(200, { sha: commit, commit: { tree: { sha: 't1' } } });
        if (path === '/git/trees/t1') return reply(200, { tree: Object.keys(files).map((p, i) => ({ path: p, type: 'blob', sha: `b${i}`, size: 10 })), truncated: false });
        const blob = /^\/git\/blobs\/b(\d+)$/.exec(path);
        if (blob) return reply(200, { content: btoa(unescape(encodeURIComponent(Object.values(files)[Number(blob[1])]))), encoding: 'base64' });
        return reply(404, { message: 'Not Found' });
      };
      publish.useTestGitHub(() => ({ baseUrl: 'https://api.github.com', headers: { Authorization: 'Bearer token' }, fetch: fetchFake }));
      await config.update('repository', 'acme/tpl/templates', vscode.ConfigurationTarget.Workspace);
      try {
        ok(await central.get(undefined, true), 'templates da empresa não lidos');
        ok(calls[0].startsWith('anon '), `primeiro sem login: ${calls[0]}`);
        ok(calls.includes('login /git/blobs/b0'), `com login depois: ${calls}`);

        calls.length = 0;
        await newPage.run(file('wiki/docs'), { template: 'runbook', title: 'Disco', path: 'disco.md', values: { owner: 'x' } });
        equal(await read('wiki/docs/disco.md'), '# Disco\n\nDa empresa.\n', 'o da empresa sobrepõe o runbook da extensão');
        equal(calls.length, 0, 'conferiu o GitHub antes de uma hora');
        await closeAll();

        const created = await newSite.run(file('site-empresa'), { template: 'site-empresa', values: { site_name: 'Empresa' } });
        ok(created, 'site da empresa não criado');
        equal(await read('site-empresa/docs/index.md'), '# Empresa\n', 'arquivo do site da empresa');
        equal(await read('site-empresa/docs/rb.md'), '# Runbook\n\nDa empresa.\n', 'página do template da empresa');

        // Sem rede: a cópia guardada continua valendo
        offline = true;
        const copy = await central.get(undefined, true);
        equal(copy?.pages.map(p => p.id).join(), 'runbook', 'sem rede, a cópia sumiu');
      } finally {
        publish.useTestGitHub(undefined);
        await config.update('repository', undefined, vscode.ConfigurationTarget.Workspace);
        for (const path of ['wiki/docs/disco.md', 'site-empresa']) await remove(path);
      }
    });

    test('site com nav: a página entra na seção clicada na árvore, sem mexer no resto do mkdocs.yml', async () => {
      const { newPage, docs } = await api();
      const write = (path: string, text: string) => vscode.workspace.fs.writeFile(file(path), new TextEncoder().encode(text));
      const yml = 'site_name: Nav\nnav:\n  - Início: index.md # capa\n  - Guias:\n      - guias/a.md\n  - GitHub: https://github.com\n';
      await write('nav-tpl/docs/index.md', '# Início\n');
      await write('nav-tpl/docs/guias/a.md', '# A\n');
      await write('nav-tpl/mkdocs.yml', yml);
      try {
        const section = await until(
          async () => {
            await docs.ready;
            const site = siteItem(docs, 'nav-tpl');
            return site && docs.getChildren(site).find(item => item.kind === 'section' && item.label === 'Guias');
          },
          Boolean,
          'seção Guias não apareceu na árvore',
        );
        const uri = await newPage.run(section, { template: 'guide', title: 'Fazer deploy', values: { owner: 'time' }, nav: true });
        ok(uri?.path.endsWith('/nav-tpl/docs/guias/fazer-deploy.md'), `página: ${uri?.path}`);
        equal(
          await read('nav-tpl/mkdocs.yml'),
          yml.replace('      - guias/a.md\n', '      - guias/a.md\n      - guias/fazer-deploy.md\n'),
          'nav',
        );
        await closeAll();
        await newPage.run(file('nav-tpl/docs'), { template: 'wiki-page', title: 'Fora', values: { owner: 'time' } });
        ok(!(await read('nav-tpl/mkdocs.yml')).includes('fora.md'), 'pôs no nav sem a pessoa pedir');
      } finally {
        await remove('nav-tpl');
      }
    });
  });
}
