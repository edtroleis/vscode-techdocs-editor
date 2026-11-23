# 08 — Repositório de templates e exemplos (Diátaxis)

## Problema

Os templates da extensão (spec 04) ficam dentro do pacote: para mudar um texto ou acrescentar um template é
preciso publicar uma versão da extensão. Quem quer ver como fica uma boa página de runbook ou de ADR não tem onde
olhar: o template é um esqueleto com texto de exemplo, não uma página preenchida. A empresa que quer os seus
próprios templates já pode apontar `techdocsEditor.templates.repository` para um repositório (TA3), mas tem de
montá-lo do zero, sem um modelo para copiar. Além disso, cada pessoa configura sozinha: não há um jeito de o time
ou a empresa deixar esse repositório como padrão para quem usa o TechDocs.

## Objetivo

Um repositório público no GitHub com os templates e páginas de exemplo, organizado pelas quatro categorias do
[Diátaxis](https://diataxis.fr/): tutorials, how-to guides, reference e explanation. Ele traz os templates que a
extensão já tem e outros novos. A extensão usa esse repositório como fonte dos templates e mostra os exemplos
dele. Uma empresa faz um fork (ou cria o seu no mesmo formato) e o deixa como padrão para os funcionários: na
engrenagem, no repositório da documentação ou pela política do VS Code.

Fora do escopo: editor de templates dentro da extensão; mais de um repositório de templates ao mesmo tempo (a
empresa que quiser juntar os oficiais com os seus faz o fork); templates em outros idiomas além de inglês e
pt-BR.

## Ponto de partida (o que já existe)

- O catálogo já segue o Diátaxis: `category: tutorial | guide | reference | explanation` no front matter, e a
  lista agrupa por categoria (spec 04).
- Treze páginas e quatro sites em `packages/core/templates/en` e `pt-br`.
- TA3: `techdocsEditor.templates.repository: [host/]dono/repo[/pasta][@ref]`, com cópia no `globalStorage` pelo
  commit, login só se o repositório pedir, workspace não confiável só com a configuração do usuário. A ordem das
  camadas é a seguinte, e o primeiro de cada id vale:
  1. o repositório aberto (o site, o workspace e `templates.paths`);
  2. o repositório da empresa;
  3. os templates da extensão.
- `techdocsEditor.templates.builtIn: false` esconde os da extensão.

## Decisões (2026-11-23, confirmadas pelo usuário)

- **Nome:** `edtroleis/techdocs-templates`, público, licença Apache-2.0 (a mesma da extensão).
- **Os exemplos são sites TechDocs, um por idioma:** `examples/en` e `examples/pt-br`, cada um com o seu
  `mkdocs.yml` e `docs/`, com as mesmas páginas de um serviço fictício ("Payments Service" / "Serviço de
  Pagamentos"). O `catalog-info.yaml` da raiz tem dois componentes, um para cada site
  (`backstage.io/techdocs-ref: dir:./examples/en` e `dir:./examples/pt-br`). Assim os exemplos podem ser lidos já
  renderizados (GitHub Pages ou o Backstage da empresa), e o repositório usa o próprio formato que ensina. Dois
  sites em vez de um site com plugin de idiomas: o `techdocs-core` não traz o `mkdocs-static-i18n`, e o TechDocs
  mostra um site por componente.
- **Estrutura:**

  ```text
  README.md / README.pt-BR.md    # o que é, como usar na extensão, como fazer o da sua empresa (fork)
  catalog-info.yaml              # dois componentes: os exemplos em inglês e em pt-BR
  examples/
    en/
      mkdocs.yml
      docs/
        index.md
        tutorials/               # tutorial.md, onboarding.md, golden-path.md
        how-to-guides/           # guide.md, how-to.md, runbook.md, troubleshooting.md
        reference/               # service-home.md, operations.md, api-reference.md, wiki-page.md,
                                 # release-notes.md, glossary.md
        explanation/             # architecture.md, adr.md, postmortem.md, rfc.md
    pt-br/
      (a mesma estrutura, em português)
  templates/
    en/
      tutorials/  how-to-guides/  reference/  explanation/    # páginas (.md com front matter)
      sites/                                                  # sites (template.yml + arquivos)
    pt-br/
      (a mesma estrutura)
  ```

  Templates e exemplos nos dois idiomas. O CI confere que `en` e `pt-br` têm os mesmos arquivos (uma página nova
  num idioma só falha).
- **Fonte da verdade:** o repositório de templates. Os templates saem do `packages/core/templates`, e a extensão
  passa a levar uma cópia deles, fixada numa tag do repositório (`v1.0.0`…), que um script traz no build. A
  extensão continua funcionando sem rede, no vscode.dev e atrás de firewall. **Não** consulta o GitHub por padrão:
  com `templates.repository` vazio, usa a cópia que já vem no pacote. Melhorar um template vira uma PR no
  repositório de templates, que entra na próxima versão da extensão.
- **Templates novos já no repositório:** os três "depois da v1" da spec 04 (RFC / design doc, Notas de versão e
  Glossário), mais "How-to curto" (uma tarefa só, sem pré-requisitos longos).
- **Um exemplo por template:** cada template aponta para o exemplo dele no front matter
  (`example: how-to-guides/runbook.md`, relativo ao `docs/` do site de exemplo do mesmo idioma). A extensão leva
  também a cópia dos exemplos. Na lista do "Nova página", o item tem o botão "Ver exemplo": abre o exemplo renderizado, a
  prévia do Markdown no VS Code a partir da cópia, sem rede.
- **Padrão da empresa, em três níveis.** O nível mais específico vale:
  1. **Usuário:** a engrenagem ou as configurações do VS Code, como hoje.
  2. **Repositório da documentação:** `templates.repository` no `.techdocs-editor.yaml` (o mesmo arquivo das
     opções da verificação e dos anexos). Viaja com o repositório: todo mundo que abre aquela documentação usa os
     templates do time. Workspace não confiável ignora esse valor, como a TA3 já faz com a configuração da pasta.
  3. **Empresa inteira:** política do VS Code (o TI distribui `techdocsEditor.templates.repository` por GPO no
     Windows, perfil no macOS ou `policy.json` no Linux). Ela trava o valor, e a engrenagem mostra
     "definido pela empresa". Depende de o VS Code aceitar políticas declaradas por extensões (ver "Conferir antes
     de implementar"). Se não aceitar, fica a configuração do usuário distribuída pelo TI, sem travar.
- **Idioma:** se a pasta do repositório tem `en/` e `pt-br/`, a extensão usa a do idioma do site
  (`core/docsLanguage.ts`); se o idioma não existe, usa `en/`. Uma pasta sem subpastas de idioma vale para todos,
  como na TA3.
- **Categoria:** a do front matter vale. Sem ela, vale o nome da pasta (`tutorials` → tutorial,
  `how-to-guides` → guide, `reference` → reference, `explanation` → explanation).

## Itens

| Id | Parte | O que faz | Estado |
|----|-------|-----------|--------|
| TR1 | Repositório | Criar `edtroleis/techdocs-templates` (público, Apache-2.0) com a estrutura acima: as 13 páginas e os 4 sites de hoje, em inglês e pt-BR, nas pastas do Diátaxis; os 4 templates novos; um exemplo preenchido por template nos dois sites de exemplo, com o `nav` pelas quatro categorias; `catalog-info.yaml` com os dois componentes; README e README.pt-BR com "como usar" e "como fazer o da sua empresa". CI: markdownlint, `mkdocs build --strict` dos dois sites, conferência do formato dos templates (o mesmo parser do `core`) e dos mesmos arquivos em `en` e `pt-br`. Tag `v1.0.0` | ✅ |
| TR2 | Núcleo | Leitura com pastas de categoria (até dois níveis) e de idioma, e o campo `example` no front matter. Vale para os templates da extensão, do repositório aberto e da empresa | ✅ |
| TR3 | Pacote | Script `sync-templates` que baixa os templates e os exemplos da tag fixada do repositório para dentro do pacote; teste que confere que a cópia bate com a tag (o build falha se alguém editar a cópia à mão); `packages/core/templates` sai do Git | ✅ |
| TR4 | Lista | Botão "Ver exemplo" em cada template que tem exemplo, na lista do "Nova página" e do "Nova documentação"; abre a prévia do exemplo (da cópia, sem rede) | ✅ |
| TR5 | Engrenagem | "Opções dos templates" no título da seção TechDocs e na lista do "Nova página". Mostra o repositório em uso e a origem dele (política da empresa, repositório da documentação, usuário ou os da extensão), com "Testar acesso", "Mostrar os templates da extensão" (`builtIn`) e "Voltar ao padrão". Ao trocar, oferece "Para o time" (diff do `.techdocs-editor.yaml`, depois grava) ou "Só para mim" (configurações do usuário), como a AX7 | ✅ |
| TR6 | Repositório da documentação | `templates.repository` no `.techdocs-editor.yaml`, entre a configuração do usuário e a política; ignorado em workspace não confiável | ✅ |
| TR7 | Empresa | `policy` na configuração `techdocsEditor.templates.repository`, se o VS Code aceitar (ver "Conferir"); a engrenagem mostra o valor travado | ❌ fora (ver decisões) |
| TR8 | Documentação | README e README.pt-BR: o repositório de templates, "Ver exemplo", a engrenagem e como uma empresa deixa o seu como padrão (os três níveis); CHANGELOG; spec 04 aponta para esta | ✅ |

## Decisões da implementação (2026-11-23)

- **TR7 sai.** As políticas do VS Code são do produto: uma extensão comum não declara `policy` nas configurações
  dela (só uma distribuição própria do VS Code, pelo `product.json`). O README explica como o TI distribui a
  configuração do usuário.
- **Ordem:** o `.techdocs-editor.yaml` vence a configuração do usuário (como o `catalog:`), para "todo mundo que abre
  aquela documentação usa os templates do time" valer. Quem grava "Só para mim" num repositório com o arquivo é
  avisado de que o do time continua valendo.
- **Cópia no pacote:** `scripts/sync-templates.mjs` gera `packages/core/src/templatesBundle.generated.ts` (um
  arquivo TypeScript com os textos, em vez de arquivos soltos: o mesmo caminho no build da extensão, no vscode.dev e
  nos testes). O CI roda `npm run sync-templates -- --check`. `TEMPLATES_REPOSITORY=<clone local>` testa mudanças
  antes da tag.
- **"Ver exemplo" só na lista do "Nova página":** os templates de site não têm `example:`. Os da extensão abrem na
  prévia do Markdown (documento só de leitura `techdocs-example:`); os da empresa abrem no GitHub
  (`examples/<idioma>/docs/` ao lado da pasta configurada), porque a cópia da empresa só tem a pasta de templates.
- **Os exemplos também passam na ida e volta do editor** (suíte do webview): quem copia um exemplo para o próprio
  site o edita no visual sem mudanças. Isso pediu ajustes no repositório de templates (v1.0.1 a v1.0.3: linha
  separadora `| --- |`, recuo de 3 espaços nos blocos de lista numerada, índice sem tabela larga, glossário com um
  título por termo).

## Conferir antes de implementar

- Se o VS Code aceita `policy` em configurações de extensões (e desde qual versão), e como fica no Linux
  (`/etc/vscode/policy.json`). Se não aceitar, TR7 sai e o README explica como distribuir a configuração do
  usuário.
- Se o leitor da TA3 aguenta a árvore do repositório de templates (`docs/` com os exemplos e imagens): ele deve
  baixar só a pasta configurada (`templates/`), sem passar do limite de 300 arquivos.
- Limite de chamadas sem login do GitHub (60 por hora por IP): com a cópia pelo commit e a conferência de hora em
  hora, uma empresa atrás de um IP só pode bater no limite; nesse caso, pedir o login, como a TA3 faz com 401/403.

## Testes

- Unitários (`core`): TR2 (categoria pela pasta e pelo front matter, idioma do site com e sem a pasta do idioma,
  `example`).
- Script (TR3): a cópia bate com a tag; uma cópia editada falha.
- VS Code (`TEST_GREP`): TR4 (o botão abre a prévia do exemplo), TR5 (respostas prontas: time e só para mim,
  "Voltar ao padrão"), TR6 (o valor do `.techdocs-editor.yaml` vence a configuração do usuário e é ignorado sem
  confiança), contra o GitHub simulado da TA3.
- Repositório de templates (TR1): o CI dele (lint, `mkdocs build --strict`, formato).
- Cenário de usuário: empresa com um fork. O usuário abre a documentação, a lista mostra os templates do fork,
  "Ver exemplo" abre o exemplo, e a engrenagem mostra "repositório da documentação" como origem.

## Fases

1. **TR1:** o repositório, que já é útil sozinho (exemplos para ler e modelo para o fork). Não depende da extensão.
2. **TR2 e TR3:** a extensão passa a ler do repositório e a levar a cópia dele.
3. **TR4 a TR6:** "Ver exemplo", engrenagem e o padrão por repositório da documentação.
4. **TR7 e TR8:** política da empresa (se der) e documentação.
