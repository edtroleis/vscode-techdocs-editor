/**
 * Testes de integração do editor visual dentro do VS Code. Só usam a API do VS Code, para a mesma
 * suíte rodar no desktop (@vscode/test-electron) e no navegador (@vscode/test-web).
 *
 * O workspace é uma cópia de test/fixtures (run.mjs): as páginas das wikis e `crlf/pagina.md`, com
 * fim de linha do Windows. Nada é gravado em disco: cada teste reverte o documento no fim.
 */
import { firstToFill } from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import type { DocsItem, DocsTreeView } from '../../../src/docsTreeView';
import type { LintService } from '../../../src/lintService';
import type { LocalSites } from '../../../src/localSites';
import type { NewPageCommand } from '../../../src/templates/newPage';
import type { PublishPanel } from '../../../src/publish/publishPanel';
import type { CatalogOptions } from '../../../src/catalogOptions';
import type { CheckView } from '../../../src/checkView';
import type { RepoCheck } from '../../../src/repoCheck';
import type { CentralTemplates } from '../../../src/templates/centralTemplates';
import type { NewSiteCommand } from '../../../src/templates/newSite';
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

type Api = {
  provider: VisualEditorProvider;
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
};

async function api(): Promise<Api> {
  const extension = vscode.extensions.getExtension<Api>('edtroleis.techdocs-editor');
  ok(extension, 'extensão não encontrada');
  return extension!.activate();
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
    const siteItem = (docs: DocsTreeView, folder: string) =>
      docs.getChildren().find(item => item.kind === 'site' && item.description === folder);

    test('site sem nav: pelas pastas, com o título 1 de cada página', async () => {
      const { docs } = await api();
      await docs.ready;
      const wiki = siteItem(docs, 'wiki');
      ok(wiki, `site wiki não está na árvore: ${outline(docs, docs.getChildren()).join(' | ')}`);
      equal(
        outline(docs, docs.getChildren(wiki)).join('\n'),
        ['Wiki de Demonstração', 'Guias (section)', '  Imagens', '  Primeiros passos', 'Processos (section)', '  Processo de aprovação'].join('\n'),
        'árvore da wiki',
      );
      const page = docs.pageItem(file('wiki/docs/guias/imagens.md'));
      ok(page, 'página sem item');
      equal(docs.getTreeItem(page!).command?.command, 'vscode.open', 'clicar na página não a abre');
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
          'Fora do nav (notInNav)',
          '  Solta',
        ];
        const actual = () => {
          const site = siteItem(docs, 'nav-site');
          return site ? outline(docs, docs.getChildren(site)).join('\n') : '';
        };
        const english = expected.map(line => line.replace('Fora do nav', 'Not in the nav')).join('\n');
        await until(actual, text => text === english || text === expected.join('\n'), 'árvore do site com nav');
        // Título mudou no arquivo: a árvore acompanha
        await write('nav-site/docs/b.md', '# Outro título\n');
        await until(actual, text => text.includes('  Outro título'), 'título novo não chegou à árvore');
      } finally {
        await vscode.workspace.fs.delete(file('nav-site'), { recursive: true });
      }
      await until(() => siteItem(docs, 'nav-site') === undefined, gone => gone, 'site removido continuou na árvore');
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
      } finally {
        await config.update('builtIn', undefined, vscode.ConfigurationTarget.Workspace);
        for (const path of ['.techdocs', 'wiki/.techdocs', 'wiki/docs/disco-cheio.md', 'wiki/docs/local.md', 'wiki/docs/z.md']) await remove(path);
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
            return docs.getChildren().find(item => item.kind === 'site' && item.description === 'site-novo');
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
        equal(await read('com-readme/docs/index.md'), '# Pagamentos\n\nVeja o [deploy](deploy.md) e o [código](src/main.ts).\n', 'página inicial do README');
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
        for (const code of ['techdocs-plugin-missing', 'nav-page-missing', 'broken-link', 'page-not-in-nav', 'catalog-missing']) {
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
          'site_name: Conferir\nnav:\n  - Início: index.md\n  - Sumiu: sumiu.md\n  - Fora: fora.md\nplugins:\n  - techdocs-core\n  - search\n',
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
      try {
        // Padrão (auto): sem o arquivo, só uma dica
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
        // A pergunta do "Preparar": não usa catalog-info.yaml
        equal(await catalogOptions.askUsage(undefined, 'no'), 'off', 'askUsage');
        equal(await read('.techdocs-editor.yaml'), 'catalog: off\n', 'catalog: off gravado para o time');
        equal(await catalogOptions.askUsage(undefined, 'unknown'), 'auto', 'não sei: fica o auto, sem gravar');
        equal(await read('.techdocs-editor.yaml'), 'catalog: off\n', '"não sei" não grava');
      } finally {
        await config().update('catalog', undefined, vscode.ConfigurationTarget.Global);
        for (const path of ['.techdocs-editor.yaml', 'catalog-info.yaml']) await remove(path);
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
            const site = docs.getChildren().find(item => item.kind === 'site' && item.description === 'nav-tpl');
            return site && docs.getChildren(site).find(item => item.kind === 'section' && item.label === 'Guias');
          },
          Boolean,
          'seção Guias não apareceu na árvore',
        );
        const uri = await newPage.run(section, { template: 'guide', title: 'Fazer deploy', values: { owner: 'time' }, nav: true });
        ok(uri?.path.endsWith('/nav-tpl/docs/guias/fazer-deploy.md'), `página: ${uri?.path}`);
        equal(
          await read('nav-tpl/mkdocs.yml'),
          yml.replace('      - guias/a.md\n', '      - guias/a.md\n      - Fazer deploy: guias/fazer-deploy.md\n'),
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
