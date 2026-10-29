# Changelog

All notable changes to the TechDocs Editor extension. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-10-29

A preview before creating the documentation, and the first part of the remote mode: edit and publish
documentation on GitHub without cloning the repository.

### Added

- **Preview before creating the documentation**: **Create the documentation** and **TechDocs: New documentation
  site…** open a preview in the TechDocs sidebar, and nothing is written until **Create**. Pick the template,
  the site name (suggested from the README) and the owner (from `catalog-info.yaml` or `CODEOWNERS`); see the
  files or the menu; uncheck pages, reorder and rename them, add pages (with the kind of page) and sections;
  keep or replace a page that already exists; copy, move or leave out the README; and click a file to read
  it. The owner is required only while `catalog-info.yaml` is going to be created.
- **TechDocs: Open documentation from GitHub…**: opens a site from a GitHub repository (URL or `owner/repo`,
  GitHub Enterprise Server with `techdocsEditor.github.host`) without cloning it, in the Documentation tree and
  the visual editor. Public repositories open without signing in. `vscode://edtroleis.techdocs-editor/open`
  links, checked before opening. `techdocsEditor.mode` chooses between GitHub and the local copy when the
  repository is also in the workspace.
- **Ctrl+S saves the draft on GitHub**: a commit on your branch for the page, created on the first save from
  the version you opened, with `[skip ci]` where there is a pipeline. Images you add go to `<docs>/assets/` on
  that branch and show in the editor.
- **Publishing panel for pages from GitHub**: Save and check (runs the pipeline and opens a draft pull
  request), Send, Discard, the checks in plain language and Set up checks, as in local mode.
- The Publishing panel says when the page is published (the merge was done on GitHub), in both modes.

## [0.4.1] - 2026-10-28

### Changed

- The **TechDocs** icon is always in the activity bar, so the extension is easy to find right after installing it.
  In a workspace with no documentation (no `mkdocs.yml`, `README.md`, `docs/` pages or `catalog-info.yaml`), the
  Documentation view says so and offers **Create the documentation**; with no folder open, it offers to open one.
  Right-click the activity bar to hide the icon if you do not need it.

## [0.4.0] - 2026-10-28

Whole documentation sites from templates or from the docs you already have, company templates, a check of what
TechDocs needs, and a sidebar of its own. Version 0.3.0 was tagged but never published: its changes are here.

### Added

- **TechDocs in the activity bar**: an icon of its own, with the **Documentation** tree, the **Check** view and
  the optional **Publishing** panel (which leave the Explorer). It shows up in workspaces with a `mkdocs.yml`,
  and also in repositories without one that have a `README.md`, a `docs/` folder with pages or a
  `catalog-info.yaml`: there it opens a welcome screen that says what was found, with **Prepare the
  documentation** and links to the walkthrough and to the TechDocs docs. Once the site exists, the
  Documentation tree takes its place.
- **Check** view: what TechDocs needs, grouped by kind, with the number of items on the icon. It checks when it
  first shows up and after each save; a click opens the file at the line, and **Fix** applies one fix after
  showing its diff.
- **Check options** (the gear in the Check view): how the check treats `catalog-info.yaml`, since not every
  Backstage reads it from the repository. **Check only if it exists** (default: a missing file is only a hint,
  not counted on the icon, with **Configure…**), **Require it** (a missing file is a problem, with a fix that
  creates a minimal `catalog-info.yaml` with the TechDocs annotation) or **Do not use it** (nothing about
  `catalog-info.yaml`). Saved for the team in `.techdocs-editor.yaml` (`catalog:`, with the diff first) or just
  for you in the `techdocsEditor.catalog` setting; the repository file wins.
- **Get started with TechDocs Editor** walkthrough (Help → Welcome): creating a site, the sidebar, a new page,
  the visual editor, the check, publishing and company templates.
- **TechDocs: New documentation site…**: creates `mkdocs.yml` (with the `nav` and the `techdocs-core` plugin)
  and the pages in `docs/` from a site template: Service docs, Team wiki or Golden path. In the workspace root,
  or in the folder you right-click; never over an existing file. Then it shows the `catalog-info.yaml`
  annotation for TechDocs, ready to copy, without changing the file.
- `README.md` as the home page: when creating a site from a template next to a README, copy it to
  `docs/index.md`, move it there (the README keeps a link to the docs), or leave it out. Links to `docs/…` are
  made relative to the docs folder.
- Adopt the docs you already have: in a folder with pages in `docs/` and no `mkdocs.yml`, **New documentation
  site** and **Prepare the documentation** offer to use those pages. Only `mkdocs.yml` is created, with the `nav`
  built from the folders and page titles and the `techdocs-core` plugin, shown in a diff first. No page changes.
- At the end of **New documentation site** and **Prepare the documentation**, without a `catalog-info.yaml`:
  "Does your Backstage use a catalog-info.yaml in the repository?" **No** stops all talk of it (`catalog: off`),
  **Yes** leads to the Check view, which offers to create it. Asked once: the answer goes to `.techdocs-editor.yaml`.
- Site templates of your own: folders with a `template.yml` in `.techdocs/templates/` (and in
  `techdocsEditor.templates.paths`). Each page comes from a page template, yours or a built-in one, or from a
  file in the folder.
- Company templates: `techdocsEditor.templates.repository` points to a folder of a GitHub repository
  (`owner/repo[/folder][@ref]`, GitHub Enterprise too) with page and site templates in the same format. They
  come between the repository's and the built-in ones, are checked at most once an hour, and keep working
  offline from the last copy. **TechDocs: Refresh company templates** checks right away.
- **TechDocs: Check the documentation of the repository**: lists in the Problems panel what TechDocs needs
  and is missing or wrong: `site_name` and the `techdocs-core` plugin, the docs folder and its home page, the
  `nav` (missing pages, pages left out), the `catalog-info.yaml` annotation, the markdownlint configuration,
  formatting problems, broken links and missing images.
- **TechDocs: Prepare the documentation in this repository**: with no `mkdocs.yml`, creates a site from a
  template or from the pages already in `docs/`; otherwise applies the fixes of the check one by one, each with
  its diff first.

### Changed

- The **Open in visual editor** button and command show up only on pages inside a `docs_dir`, not on every
  Markdown file.

## [0.2.0] - 2026-10-28

Templates of your own and pages that go straight into the site menu.

### Added

- New page from template: on a site with a `nav`, offers to add the page to it, in the section clicked in
  the Documentation tree, in the section that already lists pages of the same folder, or at the end. Only
  one line is added to `mkdocs.yml`; comments and formatting stay as they were.
- Repository templates: `.md` files with a `template:` block in `.techdocs/templates/` of the site or of the
  workspace (the site's win), and in the folders of `techdocsEditor.templates.paths`. They come first in the
  list, with the folder they came from, and replace a built-in template with the same file name.
  `techdocsEditor.templates.builtIn: false` hides the built-in templates.
- A page created from a template opens with the example text of its first section selected: start typing to
  replace it.

### Fixed

- "New page from template" right after VS Code starts no longer says there is no `mkdocs.yml` while the
  workspace is still being scanned.

## [0.1.0] - 2026-10-28

First public version: local mode (folders and clones with a `mkdocs.yml`).

### Added

- Visual editor for TechDocs/MkDocs pages, the same editor as the Backstage plugin. Opening a page never
  changes it; saving only touches what was edited. MkDocs admonitions, collapsible blocks and content tabs
  stay as editable blocks.
- The Markdown text side by side with the visual editor, following each other, with a single undo history.
- Formatting problems (markdownlint, with the repository's configuration) in plain language, in the Problems
  panel and in the visual editor; "Fix automatically" as a button, a quick fix and `source.fixAll.techdocs`.
- "Show line": the line number next to each block opens the Markdown text at that line.
- Images chosen in the visual editor are saved to `docs/assets/<timestamp>-<name>` and linked relative to
  the page (`techdocsEditor.images.maxSizeMB`, default 5). Alt text is kept.
- Search in the visual editor (Ctrl+F) with "N of M".
- Documentation tree in the Explorer, from the `nav` of `mkdocs.yml` or from the folders.
- `techdocsEditor.openVisualByDefault` to open documentation pages in the visual editor.
- Pages with Git conflict markers open as text, with a notice, until the conflict is resolved.
- Optional **Publishing** panel (`techdocsEditor.local.publishPanel`): Save draft, Save and check, Send and
  Discard through VS Code's Git and the GitHub API, a draft pull request, the checks of any CI in plain
  language with a link to the line, and **Set up checks** for repository admins. GitHub sign-in through VS
  Code (GitHub Enterprise Server too), with a clear message for SSO and OAuth app restrictions.
- **TechDocs: New page from template…** with 13 templates (tutorial, onboarding, golden path, how-to guide,
  runbook, troubleshooting, service home page, operations and support, API reference, wiki page, architecture,
  ADR and postmortem), in English and Portuguese, filled with the title, date and owner.
- English and Portuguese (Brazil).
