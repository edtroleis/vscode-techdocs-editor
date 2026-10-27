/**
 * Testes de integração do editor visual dentro do VS Code. Só usam a API do VS Code, para a mesma
 * suíte rodar no desktop (@vscode/test-electron) e no navegador (@vscode/test-web).
 *
 * O workspace é uma cópia de test/fixtures (run.mjs): as páginas das wikis e `crlf/pagina.md`, com
 * fim de linha do Windows. Nada é gravado em disco: cada teste reverte o documento no fim.
 */
import * as vscode from 'vscode';
import type { DocsItem, DocsTreeView } from '../../../src/docsTreeView';
import type { LintService } from '../../../src/lintService';
import type { LocalSites } from '../../../src/localSites';
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

type Api = { provider: VisualEditorProvider; sites: LocalSites; lint: LintService; docs: DocsTreeView };

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
}
