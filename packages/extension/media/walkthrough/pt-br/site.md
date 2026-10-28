# Um site de documentação

O TechDocs monta cada site a partir de um `mkdocs.yml` e de uma pasta de docs:

```text
meu-servico/
├── catalog-info.yaml     backstage.io/techdocs-ref: dir:.
├── mkdocs.yml            site_name, nav, plugins: [techdocs-core]
└── docs/
    ├── index.md
    └── arquitetura.md
```

**Novo site de documentação** cria tudo isso a partir de um template: Docs de serviço, Wiki de time ou Golden path.

**Preparar a documentação** corrige o que falta num site que já existe, uma mudança por vez, com o diff antes.
