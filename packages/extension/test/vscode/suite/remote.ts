/**
 * Modo remoto (fase 4b): abrir a documentação de um repositório do GitHub, sem clone. A API do GitHub é o
 * GitHub simulado. Só desktop: o GitHub simulado usa o `node:crypto`.
 */
import * as vscode from 'vscode';
import { FakeGitHub } from '../../../../core/test/fakeGitHub';
import type { DocsItem, DocsTreeView } from '../../../src/docsTreeView';
import type { MineView } from '../../../src/mineView';
import type { PublishPanel } from '../../../src/publish/publishPanel';
import type { NewPageCommand } from '../../../src/templates/newPage';
import type { ConflictPanel } from '../../../src/remote/conflictPanel';
import type { RemoteOpener } from '../../../src/remote/openRemote';
import type { useTestHistoryPick } from '../../../src/remote/pageHistory';
import type { RemoteFileSystem } from '../../../src/remote/remoteFs';
import type { RemoteRepos } from '../../../src/remote/remoteRepos';
import type { VisualEditorProvider } from '../../../src/visualEditorProvider';

type Api = { mine: MineView; remotes: RemoteRepos; remoteFs: RemoteFileSystem; opener: RemoteOpener; docs: DocsTreeView; provider: VisualEditorProvider; publish: PublishPanel; conflicts: ConflictPanel; useTestHistoryPick: typeof useTestHistoryPick; newPage: NewPageCommand };

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
      // Um de cada vez na árvore: o da página aberta; os dois no seletor
      await until(
        () => docs.ready.then(() => docs.siteCandidates.filter(c => c.remote).map(c => c.description).sort().join()),
        found => found === 'acme/wiki,acme/wiki/servico',
        'os dois sites não estão no seletor',
      );
      await until(() => labels(docs.getChildren()).filter(line => !line.startsWith(' ')).join(), roots => roots === 'Wiki da Acme', 'a árvore não mostra o site da página aberta');
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

    test('painel Publicação (4d): Salvar e verificar abre o PR e a pipeline roda; Enviar; Descartar volta à principal', async () => {
      const { opener, publish } = await api();
      const transport = () => ({ baseUrl: 'https://api.github.com', headers: { Authorization: `Bearer ${github.token}` }, fetch: github.fetch });
      publish.useTestGitHub(transport, true);
      try {
        const uri = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
        const publisher = await until(() => publish.current(), Boolean, 'o painel não acompanhou a página do GitHub', 10_000).catch(e => { throw new Error(`${e.message} ${JSON.stringify(publish.panelState)}`); });
        const branch = 'docs/pessoa-teste/docs-guias-deploy';
        ok(publish.panelState.status === 'ready', `painel: ${JSON.stringify(publish.panelState)}`);
        equal(publisher!.view().branch, branch, 'branch do rascunho');
        equal(publisher!.view().onDefaultBranch, true, 'ainda sem rascunho');

        const document = await vscode.workspace.openTextDocument(uri!);
        const change = new vscode.WorkspaceEdit();
        change.insert(uri!, new vscode.Position(document.lineCount, 0), '\nMais um passo.\n');
        await vscode.workspace.applyEdit(change);
        ok(await document.save(), 'Ctrl+S falhou');
        await publisher!.saveAndVerify();
        equal(publisher!.view().error, undefined, 'erro ao salvar e verificar');
        const pull = github.openPull(branch);
        ok(pull?.draft, 'PR em rascunho não foi aberto');
        equal(github.head(branch)?.message, 'docs: update "Deploy"', 'commit que dispara a pipeline');
        ok(github.pipelineRuns.includes(github.head(branch)!.sha), 'a pipeline não rodou');

        await publisher!.send();
        equal(publisher!.view().error, undefined, 'erro ao enviar');
        equal(github.openPull(branch)?.draft, false, 'o PR continuou em rascunho');

        await publisher!.discard();
        equal(publisher!.view().error, undefined, 'erro ao descartar');
        ok(!github.refs.has(branch), 'a branch do rascunho continuou');
        await until(() => document.getText(), t => t === FILES['docs/guias/deploy.md'], 'a página não voltou ao texto da principal');
      } finally {
        publish.useTestGitHub(undefined);
      }
    });

    test('faixa de estado e Minhas alterações: publicada, rascunho ao salvar, em revisão depois de Enviar para revisão', async () => {
      const { opener, publish, mine } = await api();
      const transport = () => ({ baseUrl: 'https://api.github.com', headers: { Authorization: `Bearer ${github.token}` }, fetch: github.fetch });
      publish.useTestGitHub(transport, true);
      try {
        const uri = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
        const state = () => publish.pageStrip?.state;
        await until(state, s => s === 'Published', 'faixa da página publicada');
        await mine.refresh();
        equal(mine.list.length, 0, 'lista com rascunho antes de salvar');

        const document = await vscode.workspace.openTextDocument(uri!);
        const change = new vscode.WorkspaceEdit();
        change.insert(uri!, new vscode.Position(document.lineCount, 0), '\nMais um passo.\n');
        await vscode.workspace.applyEdit(change);
        ok(await document.save(), 'Ctrl+S falhou');
        // O painel lê o rascunho de novo depois de salvar
        await until(state, s => s === 'Draft', 'faixa do rascunho');
        equal(publish.pageStrip?.actions[0]?.action, 'submit', 'próxima ação');
        await mine.refresh();
        equal(mine.list.map(item => `${item.draft.page} ${item.draft.state}`).join(), 'docs/guias/deploy.md draft', 'Minhas alterações com o rascunho');

        await publish.runStripAction(uri!, 'submit');
        // A pipeline simulada termina na próxima leitura das verificações
        await (await publish.current())!.refreshChecks();
        await until(state, s => s === 'In review', 'faixa em revisão', 20_000).catch(e => { throw new Error(`${e.message} ${JSON.stringify(publish.pageStrip)}`); });
        equal(github.openPull('docs/pessoa-teste/docs-guias-deploy')?.draft, false, 'o pedido de revisão continuou em rascunho');
        await mine.refresh();
        equal(mine.list.map(item => item.draft.state).join(), 'review', 'Minhas alterações em revisão');
      } finally {
        publish.useTestGitHub(undefined);
      }
    });

    test('rascunho mudado em outra janela (4e): outro trecho é juntado; o mesmo trecho abre a tela de conflito', async () => {
      const { opener, conflicts } = await api();
      const uri = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
      const document = await vscode.workspace.openTextDocument(uri!);
      const edit = (text: string) => {
        const change = new vscode.WorkspaceEdit();
        change.replace(uri!, new vscode.Range(0, 0, document.lineCount, 0), text);
        return vscode.workspace.applyEdit(change);
      };
      const branch = 'docs/pessoa-teste/docs-guias-deploy';
      const other = (text: string) => github.push(branch, github.commit('outra janela [skip ci]', { ...github.head(branch)!.files, 'docs/guias/deploy.md': text }));
      await edit('# Deploy\n\nPasso a passo.\n\nFim.\n');
      ok(await document.save(), 'o primeiro salvar falhou');

      // Outro trecho: o salvar junta as duas versões e o editor passa a mostrar o texto gravado
      other('# Deploy em produção\n\nPasso a passo.\n\nFim.\n');
      await edit('# Deploy\n\nPasso a passo.\n\nFim, com mais.\n');
      ok(await document.save(), 'o salvar com outro trecho mudado falhou');
      const merged = '# Deploy em produção\n\nPasso a passo.\n\nFim, com mais.\n';
      equal(github.head(branch)?.files['docs/guias/deploy.md'], merged, 'texto juntado no rascunho');
      await until(() => document.getText(), t => t === merged, 'o editor não mostrou o texto juntado');

      // Mesmo trecho: o salvar é recusado, a tela de conflito abre e o texto escolhido é salvo
      let shown: string[][] = [];
      conflicts.testChoices = chunks => {
        shown = chunks.flatMap(c => (c.kind === 'conflict' ? [c.theirs, c.mine] : []));
        return ['both'];
      };
      try {
        other('# Deploy em produção\n\nPasso a passo.\n\nFim da outra janela.\n');
        await edit('# Deploy em produção\n\nPasso a passo.\n\nFim desta janela.\n');
        equal(await document.save(), false, 'o salvar por cima da outra janela foi aceito');
        const saved = await until(() => github.head(branch)?.files['docs/guias/deploy.md'], t => Boolean(t?.includes('desta janela')), 'o texto escolhido não foi salvo');
        ok(saved!.includes('Fim da outra janela.') && saved!.includes('Fim desta janela.'), `as duas versões: ${saved}`);
        equal(JSON.stringify(shown), JSON.stringify([['Fim da outra janela.'], ['Fim desta janela.']]), 'trechos da tela');
        await until(() => document.isDirty, dirty => !dirty, 'a página ficou com alteração não salva');
      } finally {
        conflicts.testChoices = undefined;
      }
    });

    test('versão publicada mudou o mesmo trecho (4e): o painel trava o envio até resolver', async () => {
      const { opener, publish, conflicts } = await api();
      const transport = () => ({ baseUrl: 'https://api.github.com', headers: { Authorization: `Bearer ${github.token}` }, fetch: github.fetch });
      publish.useTestGitHub(transport, true);
      conflicts.testChoices = () => ['mine'];
      try {
        const uri = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
        const publisher = await until(() => publish.current(), Boolean, 'o painel não acompanhou a página do GitHub');
        const branch = 'docs/pessoa-teste/docs-guias-deploy';
        const document = await vscode.workspace.openTextDocument(uri!);
        const change = new vscode.WorkspaceEdit();
        change.replace(uri!, new vscode.Range(0, 0, document.lineCount, 0), '# Deploy\n\nMeu passo a passo.\n');
        await vscode.workspace.applyEdit(change);
        ok(await document.save(), 'Ctrl+S falhou');
        github.push('main', github.commit('docs: publicado', { ...github.head('main')!.files, 'docs/guias/deploy.md': '# Deploy\n\nPasso publicado.\n' }));

        await publisher!.saveAndVerify();
        equal(publisher!.view().conflict, true, 'o painel não mostrou o conflito');
        ok(!github.openPull(branch), 'abriu o PR com conflito');

        await publisher!.resolveConflict();
        equal(publisher!.view().error, undefined, 'erro ao resolver');
        equal(publisher!.view().conflict, false, 'o conflito continuou');
        equal(github.head(branch)?.parents?.length, 2, 'a resolução não é um commit de merge');
        equal(github.head(branch)?.files['docs/guias/deploy.md'], '# Deploy\n\nMeu passo a passo.\n', 'texto escolhido');

        await publisher!.saveAndVerify();
        equal(publisher!.view().error, undefined, 'erro ao salvar e verificar depois de resolver');
        ok(github.openPull(branch)?.draft, 'o PR não foi aberto depois de resolver');
      } finally {
        conflicts.testChoices = undefined;
        publish.useTestGitHub(undefined);
      }
    });

    test('histórico da página (M7): as versões publicadas; Restaurar põe o texto no editor e o Ctrl+S grava no rascunho', async () => {
      const { opener, useTestHistoryPick } = await api();
      const page = 'docs/guias/deploy.md';
      const publish = (text: string) => github.push('main', github.commit(`docs: ${text}`, { ...github.head('main')!.files, [page]: text }));
      publish('# Deploy\n\nVersão 2.\n');
      publish('# Deploy\n\nVersão 3.\n');
      const uri = await opener.fromInput(`https://github.com/acme/wiki/blob/main/${page}`);
      const document = await vscode.workspace.openTextDocument(uri!);
      let offered: string[] = [];
      useTestHistoryPick(versions => {
        offered = versions.map(v => v.title);
        return versions[2];
      });
      try {
        await vscode.commands.executeCommand('techdocsEditor.pageHistory', uri);
        equal(offered.join(' | '), 'docs: # Deploy | docs: # Deploy | docs: wiki inicial', 'versões oferecidas');
        await until(() => document.getText(), t => t === FILES[page], 'a versão restaurada não chegou ao editor');
        ok(document.isDirty, 'restaurar salvou sem a pessoa pedir');
        ok(await document.save(), 'Ctrl+S falhou');
        equal(github.head('docs/pessoa-teste/docs-guias-deploy')?.files[page], FILES[page], 'versão restaurada no rascunho');
        equal(github.head('main')?.files[page], '# Deploy\n\nVersão 3.\n', 'restaurar mudou a principal');
      } finally {
        useTestHistoryPick(undefined);
      }
    });

    test('nova página por template (TP10): commit na branch do rascunho dela, com o nav; abre do rascunho', async () => {
      const { opener, newPage } = await api();
      const deploy = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/guias/deploy.md');
      await vscode.workspace.openTextDocument(deploy!);
      const uri = await newPage.run(deploy, { template: 'wiki-page', title: 'Nova página', nav: true });
      equal(uri?.toString(), 'techdocs://github.com/acme/wiki/docs/guias/nova-pagina.md', 'endereço da página nova');
      const branch = 'docs/pessoa-teste/docs-guias-nova-pagina';
      const head = github.head(branch);
      ok(head, 'a branch do rascunho da página nova não foi criada');
      ok(head!.files['docs/guias/nova-pagina.md']?.startsWith('# Nova página'), `página no rascunho: ${head!.files['docs/guias/nova-pagina.md']}`);
      ok(head!.files['mkdocs.yml'].includes('guias/nova-pagina.md'), `nav no rascunho: ${head!.files['mkdocs.yml']}`);
      equal(head!.message, 'docs: new page "Nova página" [skip ci]', 'mensagem do commit');
      equal(github.head('main')!.files['docs/guias/nova-pagina.md'], undefined, 'a principal mudou');
      const document = await vscode.workspace.openTextDocument(uri!);
      equal(document.getText(), head!.files['docs/guias/nova-pagina.md'], 'a página aberta não veio do rascunho');

      // TP4: nunca sobrescreve
      equal(await newPage.run(deploy, { template: 'wiki-page', title: 'Deploy', path: 'guias/deploy.md' }), undefined, 'sobrescreveu a página da principal');
      equal(await newPage.run(deploy, { template: 'wiki-page', title: 'Nova página' }), undefined, 'sobrescreveu o rascunho');
    });

    test('nova página por template (TP10): os templates do repositório vêm do GitHub', async () => {
      github.push('main', github.commit('templates', {
        ...github.head('main')!.files,
        '.techdocs/templates/reuniao.md': '---\ntemplate:\n  name: Ata de reunião\n  category: reference\n---\n\n# {{title}}\n\nAta do repositório.\n',
      }));
      const { opener, newPage } = await api();
      const index = await opener.fromInput('https://github.com/acme/wiki/blob/main/docs/index.md');
      const uri = await newPage.run(index, { template: 'reuniao', title: 'Ata de outubro', path: 'atas/outubro.md' });
      equal(uri?.path, '/acme/wiki/docs/atas/outubro.md', 'página nova');
      equal(github.head('docs/pessoa-teste/docs-atas-outubro')?.files['docs/atas/outubro.md'], '# Ata de outubro\n\nAta do repositório.\n', 'texto do template do repositório');
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
