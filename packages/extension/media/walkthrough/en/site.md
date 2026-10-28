# A documentation site

TechDocs builds each site from a `mkdocs.yml` and a docs folder:

```text
my-service/
├── catalog-info.yaml     backstage.io/techdocs-ref: dir:.
├── mkdocs.yml            site_name, nav, plugins: [techdocs-core]
└── docs/
    ├── index.md
    └── architecture.md
```

**New documentation site** creates all of it from a template: Service docs, Team wiki or Golden path.

**Prepare the documentation** fixes what an existing site is missing, one change at a time, with the diff first.
