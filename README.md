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

### Start from a template

**TechDocs: New page from template…** (command palette, the **Documentation** tree, or right-click on a docs
folder) creates a page with the sections that kind of page needs, already filled with the title, the date and
the owner from `catalog-info.yaml`, and opens it in the visual editor.

| To… | Templates |
|-----|-----------|
| Learn | Tutorial, Onboarding, Golden path |
| Do a task | How-to guide, Runbook, Troubleshooting |
| Look up | Service home page, Operations and support, API reference, Wiki page |
| Understand | Architecture, Architecture decision record (numbered: `adr/0001-…`), Postmortem |

The file name comes from the title, never overwrites an existing page and never leaves the docs folder.
Templates follow the language of VS Code (English or Portuguese), pass the formatting check and open in the
visual editor without a single change. On a site with a `nav`, the page can go straight into it, in the section
you clicked in the tree; only that line is added to `mkdocs.yml`.

#### How templates evolve

| Layer | Where | How it changes |
|-------|-------|----------------|
| Built-in | This extension | A new version of the extension, updated automatically by the Marketplace |
| Your company or team | `.techdocs/templates/` in the docs repository (or in the site folder, which wins) | A pull request in that repository: nothing to publish |
| Company-wide | One GitHub repository of templates for every docs repository (`techdocsEditor.templates.repository`) | A pull request in that repository: everyone gets it within an hour |

A template is a Markdown page with a `template:` block in the front matter. Repository templates come first
in the list and replace a built-in one with the same file name (`runbook.md`). More folders go in
`techdocsEditor.templates.paths`, and `techdocsEditor.templates.builtIn: false` offers only yours. Pages
already created never change when a template changes.

Company templates live in a folder of a GitHub repository, in the same format, and come between the
repository's and the built-in ones. Set `techdocsEditor.templates.repository` to `owner/repo`, optionally with
the folder and a branch or tag (`acme/docs-templates/templates@v3`; pin a tag to choose when to update), and the
host for GitHub Enterprise (`ghe.acme.com/acme/docs-templates`). The extension tries without signing in first
(public repository) and asks for the GitHub sign-in only if needed. It checks at most once an hour, keeps a copy
for offline use, and **TechDocs: Refresh company templates** checks right away.

```markdown
---
template:
  version: 1
  name: Runbook
  description: Respond to an alert
  category: guide        # tutorial | guide | reference | explanation
  folder: runbooks
  fields:
    alert:
      prompt: Alert name
---

# {{title}}

Alert: {{alert}}. Owner: {{owner}}. Reviewed on {{date}}.
```

#### A whole documentation site

**TechDocs: New documentation site…** (command palette, or right-click on a folder) creates `mkdocs.yml`
(with the `nav` and the `techdocs-core` plugin) and the pages in `docs/`, in the workspace root or in the folder
you chose. It never overwrites a file, and it tells you the annotation to add to `catalog-info.yaml`
(`backstage.io/techdocs-ref: dir:.`) without changing it.

| Site | Pages |
|------|-------|
| Service docs | Service home page, Architecture, Operations and support, and the first ADR |
| Team wiki | Home (how to use the wiki), Onboarding, Guides, an example wiki page |
| Golden path | Overview, Getting started tutorial, Troubleshooting |

Your own site templates are folders in `.techdocs/templates/` with a `template.yml`: each file comes from a
page template (`page`, yours or a built-in one) or from a file in the folder (`source`).

```yaml
version: 1
name: Platform service
description: Docs of a service on our platform
fields:
  squad:
    prompt: Squad
files:
  - path: index.md
    title: "{{site_name}}"
    source: home.md          # .techdocs/templates/platform-service/home.md
  - path: runbooks/deploy-failed.md
    title: Deploy failed
    section: Runbooks        # a group in the nav
    page: runbook            # a page template
```

### Check and prepare the repository

**TechDocs: Check the documentation of the repository** lists, in the Problems panel, what is missing or wrong
for TechDocs to build each site: `site_name` and the `techdocs-core` plugin in `mkdocs.yml`, the docs folder
and its `index.md`, `nav` entries pointing to missing pages and pages left out of the `nav`, the
`backstage.io/techdocs-ref` annotation in `catalog-info.yaml`, the markdownlint configuration, formatting
problems, links to missing files and missing images.

**TechDocs: Prepare the documentation in this repository** creates a site from a template when there is no
`mkdocs.yml`. Otherwise it goes through the fixes one by one, showing the diff first, so you apply, skip or
stop. Broken links and missing images stay in the Problems panel: only a person knows the right target.

### Publish without leaving VS Code (optional)

For people who would rather not deal with branches and pull requests: turn on
`techdocsEditor.local.publishPanel` and a **Publishing** panel shows up in the Explorer, with the same flow as
the Backstage plugin.

| Button | What happens on GitHub |
|--------|------------------------|
| **Save draft** | Commit and push to the draft branch, with `[skip ci]`: no checks, no pull request |
| **Save and check** | Fixes what the formatting check can fix, commits, pushes and opens a **draft** pull request the first time, which starts the checks |
| **Send for publication** / **Send for review** | Marks the pull request as ready. The page is published by whoever merges it on GitHub: the panel never merges |
| **Discard** | Closes the pull request and, on a branch the panel created, deletes it here and on GitHub |

- On the default branch, saving creates `docs/<your-login>/<page>` and switches to it. On a branch of your
  own, the panel uses that branch.
- Commits only take the page and the new images in `assets/` it uses, never other changes in your workspace.
- The checks of any CI (GitHub Actions check runs and commit statuses), with failures in plain language and a
  link to the line. Without a pipeline, the formatting check of the editor is the verification.
- Repository admins get **Set up checks**: a workflow with the standard checks, the formatting rules and branch
  protection, the files in a pull request for the team to review.
- Signs in with the GitHub account of VS Code (GitHub Enterprise Server too). The token stays with VS Code.

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
| `techdocsEditor.templates.paths` | `[]` | More folders with page and site templates, relative to the workspace folder (`.techdocs/templates/` is always read) |
| `techdocsEditor.templates.repository` | `""` | Company templates in a GitHub repository: `owner/repo[/folder][@ref]` |
| `techdocsEditor.templates.builtIn` | `true` | Offer the templates that come with the extension |
| `techdocsEditor.local.publishPanel` | `false` | Show the **Publishing** panel |
| `techdocsEditor.branchPattern` | `docs/{login}/{path}` | Branch created for a draft when you are on the default branch |
| `techdocsEditor.drafts.skipCi` | `true` | **Save draft** adds `[skip ci]`, so the pipeline only runs on **Save and check** |
| `techdocsEditor.verification.mode` | `auto` | `auto` (the pipeline when there is one), `pipeline` or `editor` |
| `techdocsEditor.verification.startTimeoutSeconds` | `120` | Wait for the first check before warning that nothing started |
| `techdocsEditor.verification.checkHelp` | `{}` | Plain-language message per check name, shown when it fails |
| `techdocsEditor.polling.intervalSeconds` / `idleIntervalSeconds` | `8` / `60` | Check queries while something runs / when idle. Nothing is queried while the window is in the background |
| `techdocsEditor.github.scopes` | `["repo"]` | Scopes asked when signing in to GitHub (`public_repo` for public repositories) |

A `.techdocs-editor.yaml` at the repository root (`verification.mode`, `startTimeoutSeconds`, `checkHelp`)
wins over the settings, so the whole team gets the same checks.

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
| **TechDocs: New page from template…** | Creates a documentation page from a template and opens it in the visual editor |
| **TechDocs: New documentation site…** | Creates `mkdocs.yml` and the pages of a documentation site from a template |
| **TechDocs: Check the documentation of the repository** | Lists what is missing or wrong for TechDocs in the Problems panel |
| **TechDocs: Prepare the documentation in this repository** | Creates a site, or applies the fixes of the check one by one with the diff first |

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
- **No network in local mode** unless you turn on the publishing panel. Pages are read and written through
  VS Code; the only requests are for images your pages already link with `https://`. The panel talks only to
  the GitHub of your repository's remote, from the extension host: the token never reaches the webview. With
  `techdocsEditor.templates.repository` set, the extension also reads that repository, at most once an hour;
  in an untrusted workspace only your user setting counts, never the folder's.
- The visual editor runs in a webview with a strict content security policy: only the extension's own
  scripts run.

## Requirements and limitations

- VS Code 1.100 or later.
- Works on local folders and clones (local mode). Git stays with VS Code's source control.
- The publishing panel needs a clone with a GitHub remote and VS Code's Git extension.
- Not yet: the remote mode (edit a repository on GitHub without cloning it) and VS Code for the Web. See the
  [roadmap](specs/00-visao-geral.md#fases).
- Math (LaTeX) is off, as in TechDocs' default MkDocs setup.
- Some advanced Material for MkDocs constructs, such as grid cards and HTML blocks with `markdown`, are still
  being hardened. Review the diff before committing pages that use them.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup
and the tests.

## License

[Apache-2.0](LICENSE).
