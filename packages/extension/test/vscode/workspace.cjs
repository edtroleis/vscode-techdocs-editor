// Workspace dos testes de integração e e2e: cópia de test/fixtures num diretório temporário, mais
// uma página com fim de linha CRLF (gerada aqui para não depender de como o git grava o arquivo).
const { cpSync, mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const extensionRoot = join(__dirname, '..', '..');

function createWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'techdocs-editor-test-'));
  cpSync(join(extensionRoot, 'test', 'fixtures'), workspace, { recursive: true });
  mkdirSync(join(workspace, 'crlf'));
  writeFileSync(
    join(workspace, 'crlf', 'pagina.md'),
    '# Página CRLF\r\n\r\nTexto com fim de linha do Windows.\r\n\r\n- um\r\n- dois\r\n',
  );
  return workspace;
}

/**
 * Clone com remote do GitHub para os testes do painel de publicação (só desktop): `publicado/`, com o
 * `origin` em https://github.com/acme/wiki.git redirecionado (`url.<bare>.insteadOf`) para um
 * repositório bare local. Devolve o caminho do bare.
 */
function createPublishRepo(workspace) {
  const repo = join(workspace, 'publicado');
  const bare = mkdtempSync(join(tmpdir(), 'techdocs-editor-remote-'));
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'mkdocs.yml'), 'site_name: Publicado\n');
  writeFileSync(join(repo, 'docs', 'index.md'), '# Início\n\nTexto da página.\n');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(bare, 'init', '--bare', '-q', '-b', 'main');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Pessoa Teste');
  git(repo, 'config', 'user.email', 'pessoa@example.com');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', `url.${bare}.insteadOf`, 'https://github.com/acme/wiki.git');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/wiki.git');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'docs: wiki inicial');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return bare;
}

module.exports = { createWorkspace, createPublishRepo, extensionRoot };
