/**
 * Modo remoto (fase 4b): abrir a documentação de um repositório do GitHub, sem clone. A API do GitHub é o
 * GitHub simulado. Só desktop: o GitHub simulado usa o `node:crypto`.
 */
import * as vscode from 'vscode';
import { FakeGitHub } from '../../../../core/test/fakeGitHub';
import type { DocsItem, DocsTreeView } from '../../../src/docsTreeView';
import type { RemoteOpener } from '../../../src/remote/openRemote';
import type { RemoteFileSystem } from '../../../src/remote/remoteFs';
import type { RemoteRepos } from '../../../src/remote/remoteRepos';
import type { VisualEditorProvider } from '../../../src/visualEditorProvider';

type Api = { remotes: RemoteRepos; remoteFs: RemoteFileSystem; opener: RemoteOpener; docs: DocsTreeView; provider: VisualEditorProvider };

const FILES = {
  'README.md': '# Wiki\n',
  'mkdocs.yml': 'site_name: Wiki da Acme\nnav:\n  - Início: index.md\n  - Guias:\n      - Deploy: guias/deploy.md\n',
  'docs/index.md': '# Início\n\nTexto da página inicial.\n',
  'docs/guias/deploy.md': '# Deploy\n\nPasso a passo.\n',
  'docs/assets/logo.png': 'png',
  'servico/mkdocs.yml': 'site_name: Pagamentos\ndocs_dir: paginas\n',
  'servico/paginas/index.md': '# Pagamentos\n',
};

function ok(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recebido ${String(actual)}`);
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

const api = async () => (await vscode.extensions.getExtension<Api>('edtroleis.techdocs-editor')!.activate()) as Api;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const labels = (items: DocsItem[]): string[] => items.flatMap(item => [item.label, ...labels(item.children).map(l => `  ${l}`)]);

export function defineRemoteTests() {
  suite('Modo remoto: abrir do GitHub', function () {
    this.timeout(60_000);
    let github: FakeGitHub;

    setup(async () => {
      github = new FakeGitHub(FILES);
      const { remotes } = await api();
      remotes.useTestGitHub(() => ({ baseUrl: 'https://api.github.com', headers: { Authorization: `Bearer ${github.token}` }, fetch: github.fetch }));
      await vscode.workspace.getConfiguration('techdocsEditor').update('mode', 'remote', vscode.ConfigurationTarget.Global);
    });

    teardown(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      const { remotes } = await api();
      for (const entry of remotes.list()) await remotes.remove(entry);
      remotes.useTestGitHub(undefined);
      await vscode.workspace.getConfiguration('techdocsEditor').update('mode', undefined, vscode.ConfigurationTarget.Global);
    });

    test('dono/repo abre a página inicial no editor visual, só leitura, e o site entra na árvore', async () => {
      const { opener, docs, remotes } = await api();
      const uri = await opener.fromInput('acme/wiki', sites => sites.find(site => site.root === ''));
      equal(uri?.toString(), 'techdocs://github.com/acme/wiki/docs/index.md', 'página aberta');
      ok(
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom,
        'a página não abriu no editor visual',
      );
      equal(text(await vscode.workspace.fs.readFile(uri!)), FILES['docs/index.md'], 'texto lido do GitHub');
      equal(remotes.list().length, 1, 'site guardado na lista');

      const tree = await until(
        () => labels(docs.getChildren()),
        lines => lines.includes('Wiki da Acme'),
        'o site do GitHub não entrou na árvore',
      );
      ok(tree.includes('  Início') && tree.includes('    Deploy'), `árvore sem as páginas do nav: ${tree.join(' | ')}`);
      const page = docs.pageItem(uri!);
      ok(page, 'a página aberta não está na árvore');
    });

    test('o rascunho da pessoa tem preferência sobre a branch principal (M2)', async () => {
      github.push('docs/pessoa-teste/docs-guias-deploy', github.commit('rascunho', { ...FILES, 'docs/guias/deploy.md': '# Deploy\n\nRascunho.\n' }));
      const { opener, remoteFs } = await api();
      const uri = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
      equal(uri?.path, '/acme/wiki/docs/guias/deploy.md', 'página da URL');
      equal(text(await vscode.workspace.fs.readFile(uri!)), '# Deploy\n\nRascunho.\n', 'texto do rascunho');
      equal(remoteFs.session(uri!)?.hasBranch, true, 'sessão com o rascunho');
    });

    test('pastas e imagens do repositório pelo esquema techdocs:', async () => {
      const { opener } = await api();
      await opener.fromInput('acme/wiki', sites => sites[0]);
      const docsDir = vscode.Uri.parse('techdocs://github.com/acme/wiki/docs');
      const entries = await vscode.workspace.fs.readDirectory(docsDir);
      equal(JSON.stringify(entries), JSON.stringify([['assets', 2], ['guias', 2], ['index.md', 1]]), 'conteúdo da pasta');
      equal(text(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(docsDir, 'assets/logo.png'))), 'png', 'bytes da imagem');
      let missing = false;
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(docsDir, 'nada.md')).then(undefined, () => (missing = true));
      ok(missing, 'arquivo que não existe');
    });

    test('vários sites: escolhe pelo caminho da URL; o segundo site entra como outro nó', async () => {
      const { opener, docs, remotes } = await api();
      const uri = await opener.fromInput('https://github.com/acme/wiki/tree/main/servico');
      equal(uri?.path, '/acme/wiki/servico/paginas/index.md', 'página inicial do site da pasta');
      await opener.fromInput('acme/wiki', sites => sites.find(site => site.root === ''));
      equal(remotes.list().length, 2, 'os dois sites na lista');
      await until(
        () => labels(docs.getChildren()).filter(line => !line.startsWith(' ')),
        roots => roots.includes('Wiki da Acme') && roots.includes('Pagamentos'),
        'os dois sites não estão na árvore',
      );
    });

    test('link vscode://…/open: validado antes de abrir (B1, B3)', async () => {
      const { opener, remotes } = await api();
      const link = (query: string) => vscode.Uri.parse(`vscode://edtroleis.techdocs-editor/open?${query}`);
      for (const query of [
        'host=evil.example&repo=acme/wiki&path=docs/index.md',
        'host=github.com&repo=acme/wiki&path=../segredo.md',
        'host=github.com&repo=acme/wiki&path=docs/script.sh',
      ]) {
        equal(await opener.fromLink(link(query)), undefined, `link inválido abriu algo: ${query}`);
      }
      equal(remotes.list().length, 0, 'link inválido mexeu na lista');
      const uri = await opener.fromLink(link('host=github.com&repo=acme%2Fwiki&path=docs%2Fguias%2Fdeploy.md'));
      equal(uri?.toString(), 'techdocs://github.com/acme/wiki/docs/guias/deploy.md', 'página do link');
    });

    test('fechar tira o site da árvore e da lista', async () => {
      const { opener, docs, remotes } = await api();
      await opener.fromInput('acme/wiki', sites => sites[0]);
      // A árvore é montada 300 ms depois da mudança: espera a de agora (a do teste anterior tinha outros sites)
      const node = await until(
        () => {
          const nodes = docs.getChildren().filter(item => item.kind === 'remote');
          return nodes.length === remotes.list().length ? nodes[0] : undefined;
        },
        Boolean,
        'o site do GitHub não entrou na árvore',
      );
      await vscode.commands.executeCommand('techdocsEditor.closeRemote', node);
      equal(remotes.list().length, 0, 'o site continuou na lista');
      await until(() => docs.getChildren().some(item => item.kind === 'remote'), present => !present, 'o site continuou na árvore');
    });

    test('sem permissão de escrita (M8): abre do mesmo jeito, só leitura', async () => {
      github.canWrite = false;
      const { opener, remoteFs } = await api();
      const uri = await opener.fromInput('acme/wiki', sites => sites[0]);
      ok(uri, 'a página não abriu');
      equal(remoteFs.session(uri!)?.repo.canWrite, false, 'permissão lida do GitHub');
      equal((await vscode.workspace.fs.stat(uri!)).permissions, vscode.FilePermission.Readonly, 'stat sem a marca de só leitura');
      let refused = false;
      await vscode.workspace.fs.writeFile(uri!, new TextEncoder().encode('# Outro\n')).then(undefined, () => (refused = true));
      ok(refused, 'gravar sem permissão de escrita foi aceito');
      ok(![...github.refs.keys()].some(ref => ref.startsWith('docs/')), 'criou rascunho sem permissão');
    });

    test('Ctrl+S grava o rascunho (M3): branch criada na primeira vez, commit com [skip ci], depois sobre o anterior', async () => {
      const { opener, remoteFs } = await api();
      const uri = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
      const document = await vscode.workspace.openTextDocument(uri!);
      const edit = (text: string) => {
        const change = new vscode.WorkspaceEdit();
        change.replace(uri!, new vscode.Range(0, 0, document.lineCount, 0), text);
        return vscode.workspace.applyEdit(change);
      };
      const branch = 'docs/pessoa-teste/docs-guias-deploy';
      await edit('# Deploy\n\nPasso a passo novo.\n');
      ok(await document.save(), 'o salvar falhou');
      equal(github.head(branch)?.files['docs/guias/deploy.md'], '# Deploy\n\nPasso a passo novo.\n', 'texto no rascunho');
      equal(github.head(branch)?.message, 'docs: draft of "Deploy" [skip ci]', 'mensagem do commit');
      equal(github.head('main')?.files['docs/guias/deploy.md'], FILES['docs/guias/deploy.md'], 'a branch principal mudou');
      equal(remoteFs.session(uri!)?.hasBranch, true, 'sessão sem o rascunho');

      await edit('# Deploy\n\nSegunda versão.\n');
      ok(await document.save(), 'o segundo salvar falhou');
      equal(github.head(branch)?.files['docs/guias/deploy.md'], '# Deploy\n\nSegunda versão.\n', 'segundo commit no rascunho');
    });

    test('imagens (M6): o envio vai para o rascunho e é lido de lá; a de um rascunho salvo antes também', async () => {
      const { opener, remoteFs } = await api();
      const uri = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
      await remoteFs.saveImage(uri!, 'docs/assets/1-captura.png', new TextEncoder().encode('PNG-1'));
      equal(github.head('docs/pessoa-teste/docs-guias-deploy')?.files['docs/assets/1-captura.png'], 'PNG-1', 'imagem no rascunho');
      ok(!github.head('main')?.files['docs/assets/1-captura.png'], 'imagem na branch principal');
      const image = vscode.Uri.parse('techdocs://github.com/acme/wiki/docs/assets/1-captura.png');
      equal(text(await vscode.workspace.fs.readFile(image)), 'PNG-1', 'imagem enviada');

      // Rascunho de outra página, salvo antes, com uma imagem que a principal não tem: lida do GitHub
      github.push('docs/pessoa-teste/docs-index', github.commit('rascunho', { ...FILES, 'docs/index.md': '# Início\n\n![](assets/2-foto.png)\n', 'docs/assets/2-foto.png': 'PNG-2' }));
      await vscode.workspace.fs.readFile(vscode.Uri.parse('techdocs://github.com/acme/wiki/docs/index.md'));
      const old = vscode.Uri.parse('techdocs://github.com/acme/wiki/docs/assets/2-foto.png');
      equal((await vscode.workspace.fs.stat(old)).type, vscode.FileType.File, 'stat da imagem do rascunho');
      equal(text(await vscode.workspace.fs.readFile(old)), 'PNG-2', 'imagem do rascunho');
    });
  });
}
