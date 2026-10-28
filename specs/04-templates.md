# 04 — Templates de documentação

## Problema

Quem cria uma página nova começa da folha em branco: não sabe que seções uma página de arquitetura, um
runbook ou um onboarding costumam ter, e cada time inventa a sua estrutura. O resultado são docs
incompletas e diferentes entre serviços. O time de plataforma, que mais quer padronizar, não tem como
oferecer o seu modelo dentro do editor.

## Objetivo

Criar uma página (ou um site inteiro) a partir de um template, em poucos cliques, já no lugar certo do
`docs_dir`, no `nav` e aberta no editor visual. Templates prontos na extensão, e templates próprios da
empresa ou do time, guardados no repositório.

Fora do escopo: o Scaffolder do Backstage (templates de código). Aqui "golden path" é a **página que
documenta** um golden path, não o template que cria o serviço.

## Catálogo da extensão

Organizado pelas quatro categorias do [Diátaxis](https://diataxis.fr/), que é como a página é usada: aprender
(tutorial), fazer uma tarefa (guia), consultar (referência) e entender (explicação). Na lista de escolha, a
categoria agrupa os templates e a descrição diz quando usar cada um.

### Páginas (v1)

| Template | Categoria | Quando usar | Seções |
|----------|-----------|-------------|--------|
| Página inicial do serviço | Referência | Primeira página de um componente no catálogo | O que é; quem cuida (time, canal); links (repositório, dashboards, catálogo); dependências; como começar |
| Tutorial | Tutorial | Ensinar algo do zero, passo a passo, com resultado no fim | O que você vai construir; antes de começar; passos numerados, cada um com o resultado esperado; próximos passos |
| Onboarding | Tutorial | Primeiros dias de quem chega no time ou no serviço | Boas-vindas; acessos a pedir; ambiente local; primeira tarefa; pessoas e canais; glossário do time |
| Golden path | Tutorial | Documentar o caminho recomendado para um tipo de serviço | Quando usar (e quando não); o que você ganha; pré-requisitos; passo a passo (com o template do Scaffolder, se houver); dono do golden path; alternativas |
| Guia | Guia | Fazer uma tarefa conhecida (os "guias gerais") | Objetivo; antes de começar; passos; como conferir que deu certo; problemas comuns |
| Runbook | Guia | Responder a um alerta ou executar um procedimento de operação | Alerta ou gatilho; impacto; diagnóstico; ações (com comandos); como escalar; depois de resolver |
| Solução de problemas | Guia | Sintomas frequentes e como resolver | Uma seção por sintoma: causa provável, como confirmar, como resolver |
| Operação e suporte | Referência | Como o serviço é operado no dia a dia | Plantão e escalonamento; SLOs; alertas (com link para os runbooks); dashboards e logs; deploy e rollback; manutenção |
| Referência de API | Referência | Contrato de uma API para quem integra | Visão geral; autenticação; endpoints (método, caminho, parâmetros, exemplo, erros); limites; versões |
| Arquitetura | Explicação | Como o sistema é hoje e por quê | Contexto; visão geral (diagrama); componentes; dados; integrações; decisões importantes (links para os ADRs); riscos conhecidos |
| ADR | Explicação | Registrar uma decisão de arquitetura | Status; contexto; decisão; consequências; alternativas consideradas |
| Postmortem | Explicação | Revisão de um incidente, sem culpados | Resumo; impacto; linha do tempo; causa raiz; o que funcionou e o que não; ações (dono e prazo) |
| Página de wiki | Referência | Página livre de uma wiki de time | Resumo; conteúdo; links relacionados; última revisão |

### Páginas (depois da v1)

| Template | Categoria | Quando usar |
|----------|-----------|-------------|
| RFC / design doc | Explicação | Proposta antes da decisão (o ADR registra o resultado) |
| Notas de versão | Referência | Mudanças de cada versão, para quem usa |
| Glossário | Referência | Termos do domínio ou do time |

### Sites (conjuntos de páginas)

Criam o `mkdocs.yml`, o `docs/` com as páginas e o `nav`. Para o TechDocs, dizem o que pôr no
`catalog-info.yaml` (a anotação `backstage.io/techdocs-ref: dir:.`) sem alterar o arquivo.

| Template | Páginas |
|----------|---------|
| Docs de serviço | Página inicial do serviço; Arquitetura; Operação e suporte; `adr/` com o primeiro ADR ("Registrar decisões de arquitetura") |
| Wiki de time | Início (como usar a wiki); Onboarding; Guias; Página de wiki de exemplo |
| Golden path | Visão geral (o template Golden path); Tutorial; Solução de problemas |

## Requisitos

| # | Requisito |
|---|-----------|
| TP1 ✅ | Comando "TechDocs: Nova página a partir de template…" na paleta, no menu da árvore "Documentação" (seção ou página: cria na mesma pasta) e no menu do Explorer em pastas dentro de um `docs_dir` |
| TP2 ✅ | Lista de escolha agrupada por categoria, com descrição de cada template; os templates do repositório aparecem primeiro, marcados com a origem |
| TP3 ✅ | Pede o título; o nome do arquivo sai do título (`Guia de deploy` → `guia-de-deploy.md`, sem acento) e pode ser editado; pasta sugerida pelo template (o ADR vai para `adr/` com número: `adr/0007-usar-postgres.md`) |
| TP4 ✅ | Nunca sobrescreve: arquivo existente pede outro nome. A pasta tem de ficar dentro do `docs_dir` (template ou nome com `..` é recusado) |
| TP5 ✅ | Campos `{{nome}}` do template preenchidos na criação: `title` (o título), `date` (hoje, `AAAA-MM-DD`), `site_name` (do `mkdocs.yml`), `owner` (do `spec.owner` do `catalog-info.yaml` da raiz, se houver); os outros campos que o template declarar são perguntados um a um (com valor padrão, se o template der) |
| TP6 ✅ | Site com `nav`: oferece pôr a página no `nav`, na seção onde ela foi criada (pela árvore) ou no fim; edita o `mkdocs.yml` mantendo comentários e formatação (API `Document` do `yaml`). Sem `nav`, nada a fazer: a pasta já define o menu |
| TP7 ✅ | A página criada abre no editor visual, com o cursor no primeiro trecho a preencher (o texto de exemplo da primeira seção, selecionado: digitar o troca) |
| TP8 ✅ | Templates do repositório: arquivos `.md` em `.techdocs/templates/` (na raiz do workspace ou do site; o do site vale mais) e nas pastas de `techdocsEditor.templates.paths`. Site: uma pasta com `template.yml` e os arquivos. `techdocsEditor.templates.builtIn: false` esconde os da extensão |
| TP9 ✅ | Templates da extensão em inglês e português, pela língua do VS Code; os do repositório como estão |
| TP10 | Modo remoto (fase 4): o mesmo fluxo, com a página criada por commit na branch do rascunho e os templates do repositório lidos pela API |
| TP11 ✅ | "TechDocs: Novo site de documentação…": escolhe um template de site e a pasta (padrão: raiz do workspace, se não houver `mkdocs.yml`); cria os arquivos e mostra a anotação do `catalog-info.yaml` para copiar |

## Onde ficam e como evoluem (decidido em 2026-10-28)

| Camada | Onde fica | Como muda | Quem recebe |
|--------|-----------|-----------|-------------|
| Templates da extensão | `packages/core/templates/<língua>/` deste repositório (no `core`, para o plugin usar os mesmos na fase 7, sem copiar) | Versão nova da extensão; propostas por PR aqui, com o CI exigindo lint limpo e ida e volta idêntica | Todo mundo, pela atualização automática do Marketplace e do Open VSX |
| Templates da empresa ou do time | `.techdocs/templates/` do repositório das docs | PR no próprio repositório, versionado pelo Git; nada a publicar | Quem clona o repositório; sobrepõem os da extensão pelo nome |
| Templates centrais (TA3) | Um repositório só da empresa (`techdocsEditor.templates.repository`) | PR nesse repositório | Todo repositório que aponta para ele (configuração recomendada pelo time de plataforma) |

- O repositório do plugin não muda: os templates entram no plugin na fase 7, pelo `core` publicado no npm.
- Template só é usado na criação: página já criada não muda quando o template muda.
- O formato tem versão (`template.version`, padrão 1). A extensão continua lendo as versões antigas; um
  template de versão mais nova que a extensão conhece aparece na lista desligado, com "atualize a extensão".
- Ordem das versões da extensão: 0.1.0 sem templates (editor, lint e painel); 0.2.0 com T1 e T2; 0.3.0 com T3;
  depois, modo remoto (T4) e templates centrais (TA3).

## Formato do template

Um `.md` com front matter que descreve o template; o corpo é a página.

```markdown
---
template:
  version: 1
  name: Runbook
  description: Responder a um alerta ou executar um procedimento de operação
  category: guide          # tutorial | guide | reference | explanation
  folder: runbooks         # sugerida, relativa ao docs_dir (opcional)
  fields:
    alert:
      prompt: Nome do alerta
      default: ""
---

# {{title}}

**Alerta:** {{alert}} · **Dono:** {{owner}} · **Revisado em:** {{date}}

## Impacto

Quem é afetado e como, enquanto o alerta está ativo.
```

- O bloco `template:` sai da página criada; outras chaves do front matter (ex.: `tags`) ficam.
- `{{campo}}` sem valor vira texto vazio; `{{` sem `}}` fica como está.
- Site: `template.yml` com `name`, `description`, `fields` e a lista de arquivos (com `nav` opcional); os
  arquivos usam os mesmos campos. Formato na seção "Como ficou na T3".

## Conteúdo dos templates da extensão

- Passam no lint com a configuração padrão (`{ default: true }`) e com a das wikis de teste.
- Ida e volta byte a byte pelo editor visual (o mesmo teste das páginas das wikis).
- Instruções de preenchimento no próprio texto, como exemplo a substituir ("Quem é afetado e como…"),
  curtas. Sem comentários HTML (ver TA2).
- Só Markdown que o editor visual edita: títulos, listas, tabelas, blocos de código com linguagem,
  admonitions do MkDocs (`!!! note`). Sem HTML.

### Como ficou na T1

- **Código:** `core/src/templates.ts` (formato, campos, nome do arquivo, número, caminho, `catalog-info.yaml`,
  ordem da lista) sem `vscode`; `core/src/builtInTemplates.ts` junta os `.md` como texto (`?raw`: nativo no
  Vitest, plugin `raw-imports` no `build.mjs`). Fica fora do `index` do `core` para o webview não levar os
  templates. Comando em `extension/src/templates/newPage.ts`.
- **Pasta da página:** a pasta clicada (na árvore ou no Explorer) vale mais que a sugerida pelo template; na raiz
  das docs (ou sem clique), vale a do template (`adr/`, `runbooks/`, `postmortems/`).
- **Lista:** só os templates da extensão por enquanto (TP2 completo com os do repositório na T2); ordem por
  categoria do Diátaxis e nome.
- **Escrita dos templates:** tabelas alinhadas e campos só fora delas (o editor realinha tabelas, e um valor
  preenchido quebraria a ida e volta); linhas até 80 colunas (MD013); sem admonitions (o conteúdo recuado
  conflita com blocos de código cercados, MD046); campo no fim de linha evitado (vazio deixaria espaço sobrando,
  MD009).
- **TP7:** a página abre no editor visual com o cursor no início. Pôr o cursor no primeiro trecho a preencher
  precisa de uma mensagem nova do host para o webview; fica para a T2.
- **TA2** (instruções como comentário HTML) não foi provado na T1: os templates usam texto de exemplo. Fica para
  a T2.

### Como ficou na T3

- **Formato do site** (`template.yml`, sem bloco `template:`: a pasta já diz que é template):

  ```yaml
  version: 1
  name: Docs de serviço
  description: Documentação de um serviço do catálogo
  fields:                  # como os dos templates de página
    squad:
      prompt: Squad
  nav: true                # padrão; false deixa o menu pelas pastas
  mkdocs:                  # outras chaves do mkdocs.yml (site_name, nav e plugins são da extensão)
    markdown_extensions:
      - admonition
  files:
    - path: index.md       # relativo ao docs/
      title: "{{site_name}}"
      page: service-home   # um template de página: o do repositório antes do da extensão
    - path: adr/0001-registrar-decisoes-de-arquitetura.md
      title: Registrar decisões de arquitetura
      section: Decisões    # grupo no nav, na posição em que aparece primeiro
      source: adr-0001.md  # arquivo da pasta do template
  ```

- **Código:** `core/src/siteTemplates.ts` (leitura, campos usados, páginas preenchidas, `mkdocs.yml`, anotação
  do `catalog-info.yaml`), sem `vscode`. Os sites da extensão em `core/templates/<língua>/sites/<id>/`,
  registrados em `BUILT_IN_SITES`. Comando em `extension/src/templates/newSite.ts`; a leitura dos templates do
  repositório, comum aos dois comandos, em `templateSources.ts`.
- **Pasta:** a clicada no Explorer; senão a raiz do workspace, se não tem `mkdocs.yml`; senão uma caixa de
  pastas. Pasta com `mkdocs.yml` é recusada; página do site que já existe em `docs/` também (nada é gravado).
- **Campos:** `site_name` sempre perguntado (sugestão: o nome da pasta); `title` é o de cada arquivo; `date`,
  `owner` (TA1) e os campos do site e dos templates de página usados, perguntados uma vez para o site todo.
- **Gravação:** as páginas primeiro, o `mkdocs.yml` por último (a árvore e o lint já acham as páginas); abre a
  primeira página no editor visual.
- **`catalog-info.yaml`:** o da pasta do site ou da raiz do workspace; se não tem a anotação, uma mensagem com
  ela (caminho `dir:` relativo ao arquivo) e o botão "Copiar a anotação". O arquivo nunca é alterado.
- **`builtIn: false`** esconde os sites da extensão da lista, mas um site do repositório pode usar um template
  de página da extensão (`page`).
- **Testes:** unitários (formato, campos, páginas, `mkdocs.yml` lido pela árvore, anotação); conteúdo (registro
  completo, lint dos 6 sites, só campos automáticos); ida e volta das páginas `source` pelo editor; integração
  desktop e web (site da extensão com `catalog-info.yaml` na raiz, recusas sem gravar nada, site do repositório).

## Segurança

- Template é texto: nada é executado, nada vem da rede (no modo local).
- Campos entram como texto na página; o caminho do arquivo é validado (TP4).
- Templates do repositório são lidos também em workspace não confiável (são só Markdown), mas a origem
  aparece na lista (TP2).

## Testes

| Camada | O quê |
|--------|-------|
| Unitários (`core`) | Leitura do front matter; campos (`{{title}}`, padrões, campo sem valor); nome do arquivo a partir do título (acentos, espaços, números de ADR); caminho fora do `docs_dir` recusado; inserção no `nav` mantendo comentários |
| Conteúdo | Cada template da extensão (en e pt-BR): lint limpo e ida e volta idêntica pelo editor |
| Integração | Criar pela paleta e pela árvore (arquivo, campos, `nav`); arquivo existente não é sobrescrito; template do repositório aparece primeiro e sobrepõe por nome; `builtIn: false` |
| e2e | Menu da árvore → template → título → página aberta no visual; site novo com `mkdocs.yml` reconhecido e árvore montada |

## Fases

A ordem pedida em 2026-10-27 punha os templates depois da fase 4. Em 2026-10-28 o usuário pediu a T1 antes:
T1 a T3b e T5 não dependem do modo remoto; só a T4 espera a fase 4.

| Parte | Entrega |
|-------|---------|
| T1 ✅ | Formato, campos e criação de página no modo local (TP1 a TP5, TP7, TP9) com os 13 templates de página da v1. Feita em 2026-10-28: `core/src/templates.ts`, `core/templates/<língua>/`, comando `techdocsEditor.newPage` (paleta, árvore, Explorer). Testes: unitários (formato, campos, nome do arquivo, número, caminho), conteúdo (lint dos 26), ida e volta dos 26 pelo editor, integração desktop e web. Pendente do TP7: o cursor no primeiro trecho a preencher (a página abre no visual, com o cursor no início) |
| T2 ✅ | `nav` (TP6 ✅: `addToNav` no `core`, insere uma linha só, pelas posições do `yaml`; a seção vem da árvore, senão a das páginas da mesma pasta, senão o fim), templates do repositório (TP8 ✅: site, workspace e `templates.paths`, o primeiro de cada id vale; na lista, separados por categoria com "este repositório" e a pasta; versão nova do formato aparece e avisa), cursor no primeiro trecho (TP7 ✅: `firstToFill` no `core` acha o texto de exemplo da primeira seção; o host manda `select` e o editor seleciona o trecho) e a prova do TA2 (feita: fica o texto de exemplo, ver TA2) |
| T3 ✅ | Templates de site (TP11). Feita em 2026-10-28: comando `techdocsEditor.newSite` (paleta e Explorer), 3 sites da extensão em inglês e português, sites do repositório (`.techdocs/templates/<id>/template.yml`). Ver "Como ficou na T3" |
| T3b | Conferir e preparar a documentação do repositório (seção acima) |
| T4 | Modo remoto (TP10), junto com o que a fase 4 já entregou |
| T5 | Templates de página depois da v1 (RFC, notas de versão, glossário) |

## Preparar e conferir o repositório (proposta de 2026-10-28)

Pedido: uma feature que crie a estrutura do MkDocs num repositório ou confira se ela já está pronta. Junta-se à
T3 (templates de site) e ao "Configurar verificações" do painel (P7):

| Comando | O que faz |
|---------|-----------|
| "TechDocs: Conferir a documentação do repositório" | Relatório (painel Problemas e uma página de resultado) com o que falta ou está errado, cada item com a correção oferecida: `mkdocs.yml` (existe, `site_name`, `docs_dir` existe, plugin `techdocs-core` na lista de `plugins`), `docs/index.md`, itens do `nav` que apontam para páginas que não existem e páginas fora do `nav` (a árvore já detecta), `catalog-info.yaml` com `backstage.io/techdocs-ref`, `.markdownlint.*`, páginas com problemas de lint, links internos quebrados, imagens referenciadas que não existem |
| "TechDocs: Preparar a documentação neste repositório" | Sem `mkdocs.yml`: escolhe um template de site (T3) e cria tudo; com `mkdocs.yml`: aplica só as correções que a conferência apontou, uma por uma, com o diff antes |

A lógica da conferência fica no `core` (lista de achados com código, gravidade e correção), para o painel de
publicação, o modo remoto e o plugin usarem a mesma. Parte **T3b**, logo depois da T3.

## Pontos em aberto

| # | Ponto | Como fechar |
|---|-------|-------------|
| TA1 | De onde vem `owner` quando não há `catalog-info.yaml`: perguntar, usar o nome do Git ou deixar vazio | **Decidido na T1:** o `spec.owner` do `catalog-info.yaml` da raiz do site ou do workspace; sem ele, perguntado como os outros campos, com o nome do Git (`user.name`) como sugestão quando o `vscode.git` estiver disponível |
| TA2 | Instruções de preenchimento como comentário HTML (`<!-- -->`, somem na página publicada) em vez de texto de exemplo | **Provado na T2 (2026-10-28): fica com o texto de exemplo.** A ida e volta é idêntica (comentário sozinho, em várias linhas e no fim de um item de lista), mas o editor mostra o comentário como parágrafo comum, com `<!--` e `-->` à mostra e editável como texto: nada discreto, e fácil de quebrar para quem não conhece HTML. Só valeria com um nó próprio no `ui` que o mostrasse como dica (e o lint aceita comentário: o MD033 não o conta como HTML) |
| TA3 | Templates centrais da empresa num repositório só (`techdocsEditor.templates.repository: owner/repo/pasta`), em vez de copiar `.techdocs/templates/` em cada repositório | Depois da T4 (usa a API do GitHub da fase 4) |
| TA4 | Templates vindos do Backstage (uma entidade `Template` ou um endpoint do plugin) | Fase 7, junto com o plugin |
