# Contributing

Thanks for helping. Issues and pull requests are welcome, in English or Portuguese.

The design lives in [`specs/`](specs/00-visao-geral.md) (in Portuguese): what each part must do, how it is
tested and what is still open. Start there before a larger change.

## Repository layout

| Path | What it is |
|------|------------|
| `packages/core` | Markdown bridge for MkDocs, lint, three-way merge, GitHub client. No React, no VS Code |
| `packages/ui` | The visual editor (React + Milkdown Crepe), shared with the [Backstage plugin](https://github.com/edtroleis/backstage-plugin-techdocs-editor) |
| `packages/extension` | The VS Code extension: host (desktop and web) and the webview |
| `specs/` | Specifications and the change log for the Backstage plugin (`para-o-plugin.md`) |
| `docs/media/` | GIFs used in the README, recorded by the tests |

## Development

Requirements: Node 24 (`.nvmrc`).

```bash
npm install            # also turns on the git hooks (.githooks)
npm run build          # extension (desktop and web) and webview
npm run test:fast      # typecheck, unit and webview tests (~1 min)
npm run test:all       # everything, including real VS Code (~7 min)
```

Press F5 in VS Code to start the extension with the test wikis (`packages/extension/test/fixtures`). On a
`.md` file, use the "Open in visual editor" button in the editor title bar, or **Reopen Editor With…**.

### Tests

```bash
npm run typecheck
npm run test:unit      # Vitest: core, sync with the document, lint, Documentation tree
npm run test:webview   # Playwright: the webview bundle in Chromium (lists, roundtrip, undo, search, images)
npm run test:bundle    # webview size in the production build (budget) and lazy-loaded languages
npm run test:editor    # editor suites inherited from the Backstage plugin
npm run test:vscode    # integration suite in VS Code desktop (downloads VS Code the first time)
npm run test:web       # the same suite in VS Code for the Web
npm run test:e2e       # Playwright driving VS Code desktop without a window
npm run roundtrip -- <folder-with-md>   # roundtrip report on real docs
```

When they run:

| When | What | Where |
|------|------|-------|
| Every commit | `test:fast` | `.githooks/pre-commit` (skip: `git commit --no-verify`) |
| Every push | `test:all` | `.githooks/pre-push` (skip: `git push --no-verify`) |
| Every Claude Code edit in `packages/` | `test:fast` in the background; on failure, Claude gets the output | `.claude/hooks/test-after-edit.sh` |
| Push and pull request on GitHub | all suites | `.github/workflows/ci.yml` |

### README media

```bash
npm run record:videos                          # records the GIFs in docs/media (needs ffmpeg)
node packages/extension/media/render-icon.mjs  # media/icon.svg → media/icon.png
```

The videos are Playwright tests (`packages/extension/e2e/videos/record.spec.ts`) running the real VS Code,
so they break, and get fixed, like any other test when the UI changes.

## Rules of thumb

- **The Markdown file is the source of truth.** Opening a page must not change it, and saving must only
  touch what the person edited. Every change to the editor keeps the roundtrip tests green.
- **Code copied from the Backstage plugin** (`core`, `ui`): log every change in
  [`specs/para-o-plugin.md`](specs/para-o-plugin.md), with the reason and the test.
- **Pinned versions.** Dependencies use exact versions; GitHub Actions are pinned by commit SHA.
- **User-facing text** goes through `vscode.l10n` (host) or the `ui` messages (webview), in English and
  Portuguese (Brazil).

## License

By contributing, you agree that your contributions are licensed under the [Apache-2.0](LICENSE) license.
