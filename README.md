# TechDocs Editor para VS Code

Editor visual para páginas do TechDocs (MkDocs), com o mesmo editor do
[plugin do Backstage](https://github.com/edtroleis/backstage-plugin-techdocs-editor). Em construção: ver
[`specs/`](specs/00-visao-geral.md).

## Desenvolvimento

Requisitos: Node 24 (`.nvmrc`).

```bash
npm install
npm run build          # extensão (desktop e web) e webview
npm run typecheck
npm run test:unit      # Vitest: ponte MkDocs, sincronização com o documento
npm run test:webview   # Playwright: bundle do webview no Chromium (cursor de lista, ida e volta)
npm run test:vscode    # suíte de integração no VS Code desktop (baixa o VS Code na 1ª vez)
npm run test:web       # a mesma suíte no VS Code para navegador
npm run roundtrip -- <pasta-com-md>   # relatório de ida e volta em docs reais
```

F5 no VS Code abre a extensão com as wikis de teste (`packages/extension/test/fixtures`). Num `.md`,
o botão "Abrir no editor visual" na barra do editor (ou "Reabrir com…").

## Licença

[Apache-2.0](LICENSE).
