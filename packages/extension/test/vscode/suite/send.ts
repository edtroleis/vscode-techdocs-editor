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
}
