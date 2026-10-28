/**
 * Painel de publicação no VS Code desktop com o Git de verdade (`vscode.git`): o clone `publicado/`
 * do workspace tem o `origin` redirecionado para um repositório bare local (run.mjs), e a API do
 * GitHub é o GitHub simulado. Só desktop: no navegador não há Git.
 */
import { execFileSync } from 'node:child_process';
import * as vscode from 'vscode';
import { FakeGitHub } from '../../../../core/test/fakeGitHub';
import type { PublishPanel } from '../../../src/publish/publishPanel';

const BRANCH = 'docs/pessoa-teste/docs-index';
const PAGE = '# Início\n\nTexto da página.\n';

function ok(value: unknown, message: string) {
  if (!value) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recebido ${String(actual)}`);
}

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, message: string, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value)) {
    if (Date.now() > end) throw new Error(`${message} (último valor: ${JSON.stringify(value)})`);
    await new Promise(resolve => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

export function definePublishTests() {
  suite('Publicação (modo local)', function () {
    this.timeout(60_000);
    const bare = process.env.TECHDOCS_TEST_REMOTE!;
    const root = () => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'publicado');
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const local = (...args: string[]) => git(root().fsPath, ...args);
    let github: FakeGitHub;
    const panel = async () =>
      (await vscode.extensions.getExtension<{ publish: PublishPanel }>('edtroleis.techdocs-editor')!.activate()).publish;

    /** O GitHub simulado acompanha o bare: cada push vira um commit nele (a pipeline roda como no GitHub). */
    function syncFromBare() {
      const refs = git(bare, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads');
      for (const line of refs.split('\n').filter(Boolean)) {
        const [branch, sha] = line.split(' ');
        if (github.refs.get(branch) === sha) continue;
        const message = git(bare, 'log', '-1', '--format=%B', sha);
        github.push(branch, { sha, message, files: { 'docs/index.md': git(bare, 'show', `${sha}:docs/index.md`) } });
      }
      for (const branch of [...github.refs.keys()]) if (!refs.includes(`${branch} `)) github.refs.delete(branch);
    }

    suiteSetup(async function () {
      if (!bare) this.skip();
      github = new FakeGitHub({ 'docs/index.md': PAGE });
      (await panel()).useTestGitHub(() => ({
        baseUrl: 'https://api.github.com',
        headers: { Authorization: `Bearer ${github.token}` },
        fetch: async (input, init) => {
          syncFromBare();
          const response = await github.fetch(input, init);
          // Apagar a branch pela API apaga no bare (o "GitHub" dos pushes)
          const deleted = String(input).match(/\/git\/refs\/heads\/(.+)$/);
          if (init?.method === 'DELETE' && deleted && response.ok) git(bare, 'branch', '-D', decodeURIComponent(deleted[1]));
          return response;
        },
      }), true);
      await vscode.workspace.getConfiguration('techdocsEditor').update('local.publishPanel', true, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('git.openRepository', root().fsPath);
    });

    suiteTeardown(async () => {
      (await panel()).useTestGitHub(undefined);
      await vscode.workspace.getConfiguration('techdocsEditor').update('local.publishPanel', undefined, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('salvar e verificar, enviar e descartar com o Git de verdade', async () => {
      const publish = await panel();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root(), 'docs', 'index.md'));
      const editor = await vscode.window.showTextDocument(document);
      const publisher = await until(() => publish.current(), Boolean, 'o painel não carregou a página');
      equal(publish.panelState.status, 'ready', 'estado do painel');

      await editor.edit(edit => edit.insert(document.positionAt(document.getText().length), '\nMais texto.\n'));
      await publisher!.saveAndVerify();
      const view = publisher!.view();
      equal(view.error, undefined, 'erro ao salvar e verificar');
      equal(local('branch', '--show-current'), BRANCH, 'branch atual');
      equal(git(bare, 'log', '-1', '--format=%s', BRANCH), 'docs: update "Início"', 'commit no remote');
      ok(git(bare, 'show', `${BRANCH}:docs/index.md`).includes('Mais texto.'), 'texto não chegou ao remote');
      equal(github.pulls.length, 1, 'PR criado');
      equal(github.pulls[0].draft, true, 'PR em rascunho');
      equal(github.pipelineRuns.length, 1, 'pipeline rodou');
      await publisher!.refreshChecks();
      equal(publisher!.view().checks.summary, 'passed', 'verificações');

      await publisher!.send();
      equal(publisher!.view().error, undefined, 'erro ao enviar');
      equal(github.pulls[0].draft, false, 'PR pronto');

      // A confirmação do Descartar (diálogo modal) é aceita pelo useTestGitHub
      await publisher!.discard();
      equal(publisher!.view().error, undefined, 'erro ao descartar');
      equal(github.pulls[0].state, 'closed', 'PR fechado');
      equal(local('branch', '--show-current'), 'main', 'voltou para a main');
      equal(local('branch', '--list', BRANCH), '', 'branch local apagada');
      equal(git(bare, 'branch', '--list', BRANCH), '', 'branch remota apagada');
      await until(() => document.getText(), text => text === PAGE, 'a página não voltou ao original');
    });
  });
}
