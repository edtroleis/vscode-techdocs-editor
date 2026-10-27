// Workspace dos testes de integração e e2e: cópia de test/fixtures num diretório temporário, mais
// uma página com fim de linha CRLF (gerada aqui para não depender de como o git grava o arquivo).
const { cpSync, mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
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

module.exports = { createWorkspace, extensionRoot };
