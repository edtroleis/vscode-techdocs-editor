# TechDocs Editor para VS Code

Editor visual para páginas do TechDocs (MkDocs), com o mesmo editor do
[plugin do Backstage](https://github.com/edtroleis/backstage-plugin-techdocs-editor). Em construção: ver
[`specs/`](specs/00-visao-geral.md).

## Desenvolvimento

Requisitos: Node 24 (`.nvmrc`).

```bash
npm install            # também ativa os hooks do git (.githooks)
npm run build          # extensão (desktop e web) e webview
npm run test:fast      # typecheck, unitários e webview (~1 min)
npm run test:all       # tudo, inclusive o VS Code de verdade (~6 min)

npm run typecheck
npm run test:unit      # Vitest: núcleo, sincronização com o documento
npm run test:webview   # Playwright: bundle do webview no Chromium (cursor de lista, ida e volta, desfazer)
npm run test:editor    # suítes do editor herdadas do plugin
npm run test:vscode    # suíte de integração no VS Code desktop (baixa o VS Code na 1ª vez)
npm run test:web       # a mesma suíte no VS Code para navegador
npm run test:e2e       # Playwright dirigindo o VS Code desktop sem janela (edição, temas, histórico)
npm run roundtrip -- <pasta-com-md>   # relatório de ida e volta em docs reais
```

Testes automáticos:

| Quando | O quê | Onde |
|--------|-------|------|
| Cada commit | `test:fast` | `.githooks/pre-commit` (pular: `git commit --no-verify`) |
| Cada push | `test:all` | `.githooks/pre-push` (pular: `git push --no-verify`) |
| Cada edição do Claude Code em `packages/` | `test:fast` em segundo plano; falhou, o Claude recebe a saída | `.claude/hooks/test-after-edit.sh` |
| Push e pull request no GitHub | todas as suítes | `.github/workflows/ci.yml` |

F5 no VS Code abre a extensão com as wikis de teste (`packages/extension/test/fixtures`). Num `.md`,
o botão "Abrir no editor visual" na barra do editor (ou "Reabrir com…").

## Licença

[Apache-2.0](LICENSE).
