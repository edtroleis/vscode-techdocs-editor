# Mudanças a levar ao plugin

Código copiado do plugin ([backstage-plugin-techdocs-editor](https://github.com/edtroleis/backstage-plugin-techdocs-editor),
`plugin-techdocs-editor` 0.2.1, `-common` 0.2.0, commit `efd3784`) e mudado aqui. Na fase 7, o plugin passa a
usar os pacotes `core` e `ui` e estas mudanças chegam lá sozinhas; até lá, ficam registradas aqui.

| Data | Arquivo | Mudança | Motivo | Teste |
|------|---------|---------|--------|-------|
| 2026-10-27 | `ui/src/MarkdownEditor.tsx` | Sem `makeStyles` do Material UI: classes `docs-editor`, `docs-editor-line`, `docs-editor-problem` em `editor.css`, cores por variáveis CSS (`--docs-editor-secondary-text`, `--docs-editor-error`) | O `ui` não depende do Backstage | — (visual) |
| 2026-10-27 | `ui/src/MarkdownEditor.tsx` | Prop `onReady` e, no handle, `getMarkdown()` e `insertMarkdown()` | O host precisa saber quando o editor carregou; os testes de integração leem e inserem texto | `test/vscode/suite/tests.ts` |
| 2026-10-27 | `ui/src/messages/{en,pt-BR}.ts` | Textos `editorText.*` tirados da tradução do plugin | O `ui` não usa o `translationRef` do Backstage | `list-caret.spec.ts` (pt-BR e en) |
