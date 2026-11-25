/** Além do estilo do envio: as opções uma embaixo da outra, com rádio, e o Para o time / Só para mim. */
export const SETTINGS_CSS = `
section { margin: 0 0 18px; }
h3 { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin: 14px 0 8px; }
.option { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 10px; cursor: pointer; }
.option input { margin: 2px 0 0; flex: none; accent-color: var(--vscode-focusBorder); }
.hint { display: block; color: var(--vscode-descriptionForeground); font-size: 0.92em; margin: 2px 0 0; }
p.hint { margin: 4px 0 8px; }
.line { display: flex; gap: 6px; align-items: center; }
.box, input[type=text] { flex: 1; min-width: 0; padding: 4px 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: var(--vscode-editor-font-family); font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
input[type=text]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.scope { display: inline-flex; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #555)); border-radius: 3px; overflow: hidden;
  text-transform: none; letter-spacing: 0; }
.scope button { padding: 1px 8px; border: 0; border-radius: 0; font-size: 11px; font-weight: 400;
  color: var(--vscode-descriptionForeground); background: transparent; }
.scope button[aria-pressed=true] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.ok { color: var(--vscode-testing-iconPassed, #89d185); }
.error { color: var(--vscode-errorForeground); }
`;
