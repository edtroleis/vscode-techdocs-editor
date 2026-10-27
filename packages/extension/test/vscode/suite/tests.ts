/**
 * Testes de integração do editor visual dentro do VS Code. Só usam a API do VS Code, para a mesma
 * suíte rodar no desktop (@vscode/test-electron) e no navegador (@vscode/test-web).
 *
 * O workspace é uma cópia de test/fixtures (run.mjs): as páginas das wikis e `crlf/pagina.md`, com
 * fim de linha do Windows. Nada é gravado em disco: cada teste reverte o documento no fim.
 */
import * as vscode from 'vscode';
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

type Api = { provider: VisualEditorProvider; sites: LocalSites };

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
}
