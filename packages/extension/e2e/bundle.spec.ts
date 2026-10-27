/**
 * Bundle do webview (spec 00, R3): as linguagens dos blocos de código vêm em pedaços à parte, carregados
 * quando a página precisa. Aqui, com a CSP do webview de verdade, o pedaço do Python chega e colore o bloco.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, openVisual, test, visual } from './vscode';

test('bloco de código em Python é colorido (o pedaço da linguagem carrega no webview)', async ({
  vscode: { page, workspace },
}) => {
  writeFileSync(
    join(workspace, 'wiki/docs/codigo.md'),
    '# Código\n\n```python\ndef soma(a, b):\n    return a + b\n```\n',
  );
  const blocked: string[] = [];
  page.on('console', message => {
    if (/Content Security Policy|Failed to fetch dynamically imported module/i.test(message.text())) blocked.push(message.text());
  });
  await openVisual(page, 'wiki/docs/codigo.md');
  const line = visual(page).locator('.cm-line', { hasText: 'def soma' });
  await expect(line).toBeVisible();
  // Sem a linguagem, a linha é texto puro; com ela, `def` e `return` vêm em spans com cor
  await expect(line.locator('span', { hasText: /^def$/ })).toHaveCount(1);
  expect(blocked).toEqual([]);
});
