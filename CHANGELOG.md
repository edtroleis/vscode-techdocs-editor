# Changelog

All notable changes to the TechDocs Editor extension. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- New page from template: on a site with a `nav`, offers to add the page to it, in the section clicked in
  the Documentation tree, in the section that already lists pages of the same folder, or at the end. Only
  one line is added to `mkdocs.yml`; comments and formatting stay as they were.
- Repository templates: `.md` files with a `template:` block in `.techdocs/templates/` of the site or of the
  workspace (the site's win), and in the folders of `techdocsEditor.templates.paths`. They come first in the
  list, with the folder they came from, and replace a built-in template with the same file name.
  `techdocsEditor.templates.builtIn: false` hides the built-in templates.

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
