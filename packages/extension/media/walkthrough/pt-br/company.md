# Templates da empresa

```jsonc
// .vscode/settings.json de cada repositório de docs, ou as configurações do usuário
"techdocsEditor.templates.repository": "acme/docs-templates/templates@v3"
```

- Mesmo formato do `.techdocs/templates/`: templates de página (`.md` com bloco `template:`) e de site (pastas com `template.yml`).
- Ordem na lista: os do próprio repositório, depois os da empresa, depois os da extensão. O mesmo nome de arquivo substitui o da camada seguinte.
- Repositório público não pede login; privado usa o seu login do GitHub no VS Code.
- Conferidos no máximo uma vez por hora e guardados para usar sem rede. Fixe uma tag (`@v3`) para escolher quando atualizar.
