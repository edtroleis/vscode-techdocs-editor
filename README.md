<p align="center">
  <img src="https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/packages/extension/media/icon.png" width="112" alt="TechDocs Editor icon">
</p>

<h1 align="center">TechDocs Editor for VS Code</h1>

<p align="center">
  Edit <a href="https://backstage.io/docs/features/techdocs/">TechDocs</a> and MkDocs pages like a document,
  without breaking the Markdown your pipeline expects.
</p>

<p align="center">
  <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

![Pick a page in the Documentation tree, edit it in the visual editor with the Markdown text side by side, and save](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/visual-editor.gif)

Docs-as-code works well for developers and badly for everyone else: product managers, support, designers and
new hires avoid the docs because of Markdown, admonitions and a lint that fails in the pipeline. TechDocs
Editor gives them a visual editor inside VS Code, and gives the repository back exactly the Markdown it had,
plus their changes.

It is the same editor as the [TechDocs editor plugin for Backstage](https://github.com/edtroleis/backstage-plugin-techdocs-editor),
so pages edited in the portal and in VS Code come out the same.

## Features

### A visual editor that keeps your Markdown

- **Opening a page never changes it.** Saving only touches what you edited: the rest of the file stays byte
  for byte, so diffs and reviews stay small.
- **MkDocs syntax is kept.** Admonitions (`!!! note`), collapsible blocks (`???`) and content tabs (`===`)
  stay as editable blocks instead of being turned into HTML.
- **Familiar editing:** a toolbar like a word processor, `/` to insert blocks, tables, task lists, code
  blocks with syntax highlighting, links and images. Images keep their alt text.
- **It is still a text file.** Open the Markdown side by side and edit either one: both follow each other,
  with a single undo history (Ctrl+Z works the same in both).
- **Your theme:** light, dark and high contrast, with VS Code's colors and fonts.

### Formatting problems in plain language

![Formatting problems listed in plain language; the line number opens the Markdown at the problem; one click fixes them](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/lint-and-fix.gif)

- The same [markdownlint](https://github.com/DavidAnson/markdownlint) rules your pipeline runs, with your
  repository's `.markdownlint.{jsonc,json,yaml,yml}`, checked while you type.
- Problems in the **Problems** panel and in the visual editor, explained in plain language ("There is more
  than one Heading 1 on the page") instead of rule codes.
- **Fix automatically:** a button in the visual editor, a quick fix (light bulb) in the text, and
  `source.fixAll.techdocs` for fix-on-save.
- **Show line:** the line number next to each block opens the Markdown text right there.

### Images go where MkDocs expects them

![Insert an image from the computer: it is saved to docs/assets and linked relative to the page](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/images.gif)

Choose an image from your computer and it is saved to `docs/assets/<timestamp>-<name>`, linked relative to
the page. Never a temporary `blob:` address, and never larger than you allow
(`techdocsEditor.images.maxSizeMB`).

### Find your way around

![Ctrl+F in the visual editor highlights the matches and counts them](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/search.gif)

- **Documentation tree** in the Explorer: the pages of each MkDocs site in the workspace, in the order of
  the `nav` in `mkdocs.yml` (or of the folders, without a `nav`), with the page titles. Pages missing from
  the `nav`, and `nav` entries pointing to missing pages, are flagged.
- **Search** with Ctrl+F in the visual editor, with "1 of 3" and Enter / Shift+Enter between matches.

## Getting started

1. Install **TechDocs Editor** from the VS Code Marketplace.
2. Open a folder that has a `mkdocs.yml` (the extension starts on its own there).
3. Open a page:
   - from the **Documentation** section in the Explorer, or
   - with the **Open in visual editor** button in the editor title bar of a `.md` file, or
   - with **Reopen Editor With… → TechDocs visual editor**.

To always open documentation pages in the visual editor, turn on `techdocsEditor.openVisualByDefault`. Use
**Reopen Editor With…** or **TechDocs: Open as Markdown text** to see the text.

## Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| `techdocsEditor.openVisualByDefault` | `false` | Open pages inside a MkDocs `docs_dir` in the visual editor instead of the text |
| `techdocsEditor.images.maxSizeMB` | `5` | Largest image the visual editor saves to `assets`. Images go into the repository: large files weigh on every clone |

Fix formatting on save:

```jsonc
"[markdown]": {
  "editor.codeActionsOnSave": { "source.fixAll.techdocs": "explicit" }
}
```

## Commands

| Command | What it does |
|---------|--------------|
| **TechDocs: Open in visual editor** | Opens the current `.md` file in the visual editor |
| **TechDocs: Open as Markdown text** | Opens the text of the page side by side with the visual editor |

## How the lint finds its configuration

For each page, the extension looks for `.markdownlint.jsonc`, `.json`, `.yaml` or `.yml` from the folder of
the page's `mkdocs.yml` up to the workspace folder, and uses the first one it finds (markdownlint's defaults
otherwise). Only pages inside a `docs_dir` are checked.

- **Restricted mode:** in an untrusted workspace, the repository's configuration is not read and pages are
  not checked until you trust the folder.
- **With the [markdownlint extension](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint)
  installed,** its diagnostics win in the Problems panel, so you don't see each problem twice. The visual
  editor still shows the list.

## Privacy and security

- **No telemetry.** The extension collects nothing.
- **No network in local mode.** Pages are read and written through VS Code. The only requests are for
  images your pages already link with `https://`.
- The visual editor runs in a webview with a strict content security policy: only the extension's own
  scripts run.

## Requirements and limitations

- VS Code 1.100 or later.
- Works on local folders and clones (local mode). Git stays with VS Code's source control.
- Not yet: the optional publishing panel (branch, pull request and checks without leaving VS Code), the
  remote mode (edit a repository on GitHub without cloning it), VS Code for the Web, and documentation
  templates. See the [roadmap](specs/00-visao-geral.md#fases).
- Math (LaTeX) is off, as in TechDocs' default MkDocs setup.
- Some advanced Material for MkDocs constructs, such as grid cards and HTML blocks with `markdown`, are still
  being hardened. Review the diff before committing pages that use them.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup
and the tests.

## License

[Apache-2.0](LICENSE).
