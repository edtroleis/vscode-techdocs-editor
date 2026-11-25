/**
 * Clonar e Enviar (spec 09) com o Git de verdade (`vscode.git`): um repositório num diretório temporário com o
 * `origin` num repositório bare local. Só desktop: no navegador não há Git.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RepoGit } from '../../../src/publish/types';
import type { SendService } from '../../../src/send/sendService';
import { preflight } from '../../../src/send/preflight';
import { CloneFlow } from '../../../src/clone/cloneFlow';
import { FakeGitHub } from '../../../../core/test/fakeGitHub';
import { useTestTransport } from '../../../src/publish/githubAuth';
import { gitApi, VscodeGit } from '../../../src/publish/vscodeGit';

function equal<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: esperado ${e}, recebido ${a}`);
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** Um repositório com `docs/Visão Geral.md` e `docs/b.md` na principal, já enviado ao bare. */
function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), 'techdocs-enviar-'));
  const bare = join(base, 'origin.git');
  const repo = join(base, 'guia');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  git(base, 'init', '--bare', '-q', '-b', 'main', bare);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Pessoa Teste');
  git(repo, 'config', 'user.email', 'pessoa@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'mkdocs.yml'), 'site_name: Guia\n');
  writeFileSync(join(repo, 'docs', 'Visão Geral.md'), '# Visão Geral\n\nTexto.\n');
  writeFileSync(join(repo, 'docs', 'b.md'), '# B\n\nTexto.\n');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'docs: inicial');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  return { base, bare, repo };
}

async function open(repo: string): Promise<RepoGit> {
  const api = (await gitApi())!;
  const repository = await api.openRepository(vscode.Uri.file(repo));
  if (!repository) throw new Error('o Git do VS Code não abriu o repositório');
  return new VscodeGit(repository);
}

/** Outra pessoa publica na principal: um commit pelo bare, por um clone à parte. */
function publishElsewhere(bare: string, base: string, path: string, text: string) {
  const other = join(base, `outro-${Date.now()}`);
  git(base, 'clone', '-q', bare, other);
  git(other, 'config', 'user.name', 'Ana');
  git(other, 'config', 'user.email', 'ana@example.com');
  git(other, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(other, path), text);
  git(other, 'commit', '-q', '-am', 'docs: da Ana');
  git(other, 'push', '-q', 'origin', 'main');
}

export function defineSendTests() {
  suite('RepoGit (Git do repositório inteiro)', function () {
    this.timeout(60_000);

    test('diffWith acha as mudanças pelo conteúdo, com acento e não versionadas', async () => {
      const { repo } = makeRepo();
      const repoGit = await open(repo);
      writeFileSync(join(repo, 'docs', 'Visão Geral.md'), '# Visão Geral\n\nTexto novo.\n');
      writeFileSync(join(repo, 'docs', 'novo.md'), '# Novo\n');
      // Salvo de volta igual ao da principal: não é mudança
      writeFileSync(join(repo, 'docs', 'b.md'), '# B\n\nTexto.\n');
      await repoGit.refresh();
      const changes = (await repoGit.diffWith('origin/main')).sort((a, b) => a.path.localeCompare(b.path));
      equal(changes, [
        { path: 'docs/novo.md', status: 'added' },
        { path: 'docs/Visão Geral.md', status: 'modified' },
      ], 'mudanças');
      equal(repoGit.defaultBranch(), 'main', 'branch principal');
    });

    test('restoreFrom volta o arquivo ao da principal e apaga o novo', async () => {
      const { repo } = makeRepo();
      const repoGit = await open(repo);
      writeFileSync(join(repo, 'docs', 'b.md'), 'mudado\n');
      writeFileSync(join(repo, 'docs', 'novo.md'), '# Novo\n');
      await repoGit.restoreFrom('origin/main', ['docs/b.md', 'docs/novo.md']);
      equal(readFileSync(join(repo, 'docs', 'b.md'), 'utf8'), '# B\n\nTexto.\n', 'b.md');
      equal(existsSync(join(repo, 'docs', 'novo.md')), false, 'novo.md apagado');
    });

    test('merge sem sobreposição junta sozinho; com sobreposição devolve o caminho', async () => {
      const { base, bare, repo } = makeRepo();
      const repoGit = await open(repo);
      await repoGit.createBranch('docs/pessoa/envio');
      writeFileSync(join(repo, 'docs', 'b.md'), '# B\n\nTexto meu.\n');
      await repoGit.refresh();
      await repoGit.commit(['docs/b.md'], 'docs: b');
      publishElsewhere(bare, base, 'docs/Visão Geral.md', '# Visão Geral\n\nDa Ana.\n');
      await repoGit.fetch();
      equal(await repoGit.merge('origin/main'), [], 'sem conflito');
      equal(readFileSync(join(repo, 'docs', 'Visão Geral.md'), 'utf8'), '# Visão Geral\n\nDa Ana.\n', 'trouxe a da Ana');
      publishElsewhere(bare, base, 'docs/b.md', '# B\n\nTexto da Ana.\n');
      await repoGit.fetch();
      equal(await repoGit.merge('origin/main'), ['docs/b.md'], 'conflito');
      git(repo, 'merge', '--abort');
    });

    test('unstackOnto volta à principal com as mudanças não commitadas', async () => {
      const { repo } = makeRepo();
      const repoGit = await open(repo);
      await repoGit.createBranch('docs/pessoa/envio');
      writeFileSync(join(repo, 'docs', 'b.md'), '# B\n\nTexto meu.\n');
      writeFileSync(join(repo, 'docs', 'novo.md'), '# Novo\n');
      await repoGit.refresh();
      await repoGit.commit(['docs/b.md', 'docs/novo.md'], 'docs: envio');
      equal(await repoGit.unstackOnto('main', 'origin/main'), [], 'sem conflito');
      await repoGit.refresh();
      equal(repoGit.currentBranch(), 'main', 'na principal');
      equal(readFileSync(join(repo, 'docs', 'b.md'), 'utf8'), '# B\n\nTexto meu.\n', 'b.md mantido');
      equal(repoGit.changedFiles().sort(), ['docs/b.md', 'docs/novo.md'], 'não commitadas');
    });
  });

  suite('Enviar (N)', function () {
    this.timeout(60_000);
    const root = () => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'publicado');
    const service = async () =>
      (await vscode.extensions.getExtension<{ send: SendService }>('edtroleis.techdocs-editor')!.activate()).send;

    teardown(() => {
      git(root().fsPath, 'checkout', '-q', '--', '.');
      git(root().fsPath, 'clean', '-qfd', 'docs');
    });

    test('conta as mudanças da documentação e marca os arquivos', async () => {
      const send = await service();
      writeFileSync(join(root().fsPath, 'docs', 'index.md'), '# Início\n\nTexto mudado.\n');
      writeFileSync(join(root().fsPath, 'docs', 'novo.md'), '# Novo\n');
      writeFileSync(join(root().fsPath, 'fora.txt'), 'fora da documentação\n');
      await send.refresh();
      const repo = send.list().find(r => r.root.path.endsWith('/publicado'));
      equal(repo?.count, 2, 'mudanças para enviar');
      equal(send.provideFileDecoration(vscode.Uri.joinPath(root(), 'docs', 'index.md'))?.badge, 'M', 'alterada');
      equal(send.provideFileDecoration(vscode.Uri.joinPath(root(), 'docs', 'novo.md'))?.badge, 'N', 'nova');
      equal(send.provideFileDecoration(vscode.Uri.joinPath(root(), 'fora.txt')), undefined, 'fora da documentação');
      git(root().fsPath, 'clean', '-qf', 'fora.txt');
    });
  });

  suite('Primeiro envio: criar o repositório e a identidade', function () {
    this.timeout(60_000);
    let github: FakeGitHub;
    setup(() => {
      github = new FakeGitHub({});
      github.login = 'pessoa';
      github.userName = 'Pessoa Teste';
      github.emails = [{ email: 'pessoa@empresa.com', primary: true }];
      useTestTransport(() => ({ baseUrl: 'https://api.github.com', headers: { Authorization: `Bearer ${github.token}` }, fetch: github.fetch.bind(github) }));
    });
    teardown(() => useTestTransport(undefined));

    test('criar o repositório: diretório sem Git vira repositório privado ligado ao GitHub', async () => {
      const folder = join(mkdtempSync(join(tmpdir(), 'techdocs-novo-')), 'manual-da-equipe');
      mkdirSync(join(folder, 'docs'), { recursive: true });
      mkdirSync(join(folder, 'src'));
      writeFileSync(join(folder, 'mkdocs.yml'), 'site_name: Manual\n');
      writeFileSync(join(folder, 'docs', 'index.md'), '# Manual\n');
      writeFileSync(join(folder, 'src', 'a.ts'), 'export {};\n');
      git(folder, 'config', '--global', 'user.name', 'Pessoa Teste');
      git(folder, 'config', '--global', 'user.email', 'pessoa@empresa.com');
      const result = await preflight(undefined, vscode.Uri.file(folder), {
        pickOwner: async (owners, name) => ({ owner: owners[0].login, name, private: true }),
        pickIdentity: async () => undefined,
      });
      equal(result?.firstSend, true, 'primeiro envio');
      equal(github.createdRepos, [{ path: '/user/repos', name: 'manual-da-equipe', private: true, auto_init: false }], 'repositório criado');
      equal(git(folder, 'remote', 'get-url', 'origin'), 'https://github.com/pessoa/manual-da-equipe.git', 'origin');
      equal(result?.git.currentBranch(), 'main', 'na main');
    });

    test('identidade: sem nome e e-mail do Git, grava o escolhido para todo o computador', async () => {
      const { repo, bare } = makeRepo();
      git(repo, 'config', `url.${bare}.insteadOf`, 'https://github.com/pessoa/guia.git');
      git(repo, 'remote', 'set-url', 'origin', 'https://github.com/pessoa/guia.git');
      git(repo, 'config', '--unset', 'user.name');
      git(repo, 'config', '--unset', 'user.email');
      for (const key of ['user.name', 'user.email']) {
        try {
          git(repo, 'config', '--global', '--unset-all', key);
        } catch {
          // não estava gravado
        }
      }
      const shown: string[] = [];
      const result = await preflight(await open(repo), vscode.Uri.file(repo), {
        pickOwner: async () => undefined,
        pickIdentity: async choices => {
          shown.push(...choices.map(c => c.email));
          return choices[0];
        },
      });
      equal(result?.firstSend, false, 'repositório que já existia');
      equal(shown.at(-1), `${github.userId}+pessoa@users.noreply.github.com`, 'o e-mail privado por último');
      equal(git(repo, 'config', '--global', 'user.name'), 'Pessoa Teste', 'nome');
      equal(git(repo, 'config', '--global', 'user.email'), 'pessoa@empresa.com', 'e-mail');
    });
  });

  suite('Clonar e o link do Backstage', function () {
    this.timeout(60_000);
    const memento = () => {
      const data = new Map<string, unknown>();
      return { keys: () => [...data.keys()], get: (key: string) => data.get(key), update: async (key: string, value: unknown) => void data.set(key, value) } as unknown as vscode.Memento;
    };
    suiteSetup(() => vscode.commands.executeCommand('git.openRepository', join(vscode.workspace.workspaceFolders![0].uri.fsPath, 'publicado')));
    teardown(() => vscode.commands.executeCommand('workbench.action.closeAllEditors'));

    test('link com o repositório já no computador abre a página sem clonar', async () => {
      const flow = new CloneFlow({ state: memento(), parent: '/nao/deve/clonar' });
      const opened = await flow.fromLink(vscode.Uri.parse('vscode://edtroleis.techdocs-editor/open?host=github.com&repo=acme/wiki&path=docs/index.md'));
      equal(opened?.path.endsWith('/publicado/docs/index.md'), true, 'abriu a cópia do workspace');
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
      equal(tab?.uri?.path.endsWith('/publicado/docs/index.md'), true, 'a página está aberta');
    });

    test('link sem Git no computador: aviso com o link para instalar', async () => {
      const warned: string[][] = [];
      const flow = new CloneFlow({
        state: memento(),
        git: async () => undefined,
        warn: async (message, ...actions) => (warned.push([message, ...actions]), undefined),
      });
      const opened = await flow.fromLink(vscode.Uri.parse('vscode://edtroleis.techdocs-editor/open?host=github.com&repo=acme/outro&path=docs/a.md'));
      equal(opened, undefined, 'nada aberto');
      equal(warned.length, 1, 'um aviso');
      equal(warned[0][1], 'Install Git', 'o botão de instalar');
    });

    test('link inválido não abre nada', async () => {
      const flow = new CloneFlow({ state: memento(), parent: '/nao/deve/clonar' });
      equal(await flow.fromLink(vscode.Uri.parse('vscode://edtroleis.techdocs-editor/open?host=github.com&repo=acme/wiki&path=../fora.md')), undefined, 'inválido');
    });
  });

  suite('Configurações pelo menu da seção', function () {
    this.timeout(30_000);
    const config = () => vscode.workspace.getConfiguration('techdocsEditor');
    teardown(async () => {
      await config().update('send.target', undefined, vscode.ConfigurationTarget.Global);
      await config().update('clone.directory', undefined, vscode.ConfigurationTarget.Global);
    });

    test('no "…" da seção, um item só: Configurações… (os antigos abrem a janela)', () => {
      const pkg = vscode.extensions.getExtension('edtroleis.techdocs-editor')!.packageJSON;
      const menu = (pkg.contributes.menus['view/title'] as Array<{ command: string; when: string; group: string }>).filter(m =>
        m.when.includes('techdocsEditor\\.docs'),
      );
      const item = menu.find(m => m.command === 'techdocsEditor.settings');
      equal(Boolean(item) && !item!.group.startsWith('navigation'), true, 'Configurações… no "…"');
      for (const old of ['techdocsEditor.sendOptions', 'techdocsEditor.cloneOptions', 'techdocsEditor.templateOptions']) {
        equal(menu.some(m => m.command === old), false, `${old} fora do "…"`);
      }
      const view = (pkg.contributes.views.techdocs as Array<{ id: string; when?: string }>).find(v => v.id === 'techdocsEditor.settingsView');
      equal(view?.when, 'techdocsEditor.settingsOpen', 'a janela só aparece quando aberta');
    });
  });
}
