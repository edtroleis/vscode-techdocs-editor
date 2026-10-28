# Company templates

```jsonc
// .vscode/settings.json of each docs repository, or the user settings
"techdocsEditor.templates.repository": "acme/docs-templates/templates@v3"
```

- Same format as `.techdocs/templates/`: page templates (`.md` with a `template:` block) and site templates (folders with a `template.yml`).
- Order in the list: the repository's own, then the company's, then the built-in ones. The same file name replaces the next layer.
- Public repositories need no sign-in; private ones use your GitHub sign-in in VS Code.
- Checked at most once an hour and kept for offline use. Pin a tag (`@v3`) to choose when to update.
