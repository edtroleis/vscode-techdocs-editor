// Workspace dos testes de integração: cópia de test/fixtures num diretório temporário, mais uma
// página com fim de linha CRLF (gerada aqui para não depender de como o git grava o arquivo).
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function createWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'techdocs-editor-test-'));
  cpSync(join(extensionRoot, 'test', 'fixtures'), workspace, { recursive: true });
  mkdirSync(join(workspace, 'crlf'));
  writeFileSync(
    join(workspace, 'crlf', 'pagina.md'),
    '# Página CRLF\r\n\r\nTexto com fim de linha do Windows.\r\n\r\n- um\r\n- dois\r\n',
  );
  return workspace;
}
