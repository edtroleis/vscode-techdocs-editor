/** Estilo da tela de envio e do painel Envio: as cores do tema do VS Code. */
export const SEND_CSS = `
body { padding: 8px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h2 { font-size: 1.3em; margin: 8px 0 2px; }
h3 { font-size: 1em; margin: 16px 0 6px; }
p { margin: 6px 0; }
.muted { color: var(--vscode-descriptionForeground); }
.path { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0; }
button { padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer;
  color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
a { color: var(--vscode-textLink-foreground); cursor: pointer; }
ul { list-style: none; padding: 0; margin: 4px 0; }
li.item { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--vscode-widget-border, #8883); }
.group { margin-top: 10px; font-weight: 600; }
.kind { font-size: 0.8em; font-weight: 600; padding: 1px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.kind.added { background: var(--vscode-gitDecoration-addedResourceForeground, #3a3); color: var(--vscode-editor-background); }
.kind.deleted { background: var(--vscode-gitDecoration-deletedResourceForeground, #c33); color: var(--vscode-editor-background); }
.grow { flex: 1; }
textarea { width: 100%; box-sizing: border-box; min-height: 3em; font: inherit; color: var(--vscode-input-foreground);
  background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
.ok { color: var(--vscode-testing-iconPassed); }
.fixable { color: var(--vscode-editorWarning-foreground); }
.blocking { color: var(--vscode-errorForeground); }
.info { border-left: 3px solid var(--vscode-notificationsInfoIcon-foreground); padding-left: 8px; color: var(--vscode-descriptionForeground); }
.error { border-left: 3px solid var(--vscode-errorForeground); padding-left: 8px; color: var(--vscode-errorForeground); }
.step { display: flex; gap: 8px; margin: 6px 0; }
.check-failed { color: var(--vscode-testing-iconFailed); }
.check-passed { color: var(--vscode-testing-iconPassed); }
.check-running { color: var(--vscode-testing-iconQueued); }
`;
