<p align="center">
  <img src="https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/packages/extension/media/icon.png" width="112" alt="Ícone do TechDocs Editor">
</p>

<h1 align="center">TechDocs Editor para VS Code</h1>

<p align="center">
  Edite páginas do <a href="https://backstage.io/docs/features/techdocs/">TechDocs</a> e do MkDocs como um
  documento, sem quebrar o Markdown que a sua pipeline espera.
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

![Escolher uma página na árvore Documentação, editar no editor visual com o texto Markdown ao lado e salvar](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/visual-editor.gif)

Docs-as-code funciona bem para quem programa e mal para o resto do time: produto, suporte, design e quem
acabou de chegar evitam a documentação por causa do Markdown, das admonitions e de um lint que falha na
pipeline. O TechDocs Editor dá a essas pessoas um editor visual dentro do VS Code e devolve ao repositório
exatamente o Markdown que ele tinha, mais as alterações delas.

É o mesmo editor do [plugin TechDocs editor para o Backstage](https://github.com/edtroleis/backstage-plugin-techdocs-editor):
páginas editadas no portal e no VS Code saem iguais.

## Recursos

### Um editor visual que mantém o seu Markdown

- **Abrir uma página nunca a altera.** Salvar só mexe no que você editou: o resto do arquivo fica igual,
  byte a byte, e os diffs e revisões continuam pequenos.
- **A sintaxe do MkDocs fica.** Admonitions (`!!! note`), blocos recolhíveis (`???`) e abas de conteúdo
  (`===`) continuam como blocos editáveis, em vez de virar HTML.
- **Edição conhecida:** barra de ferramentas como a de um editor de texto, `/` para inserir blocos,
  tabelas, listas de tarefas, blocos de código com cores, links e imagens. As imagens mantêm o texto
  alternativo.
- **Continua sendo um arquivo de texto.** Abra o Markdown ao lado e edite qualquer um dos dois: um
  acompanha o outro, com um histórico só de desfazer (o Ctrl+Z funciona igual nos dois).
- **O seu tema:** claro, escuro e alto contraste, com as cores e fontes do VS Code.

### Problemas de formatação em linguagem simples

![Problemas de formatação listados em linguagem simples; o número da linha abre o Markdown no problema; um clique corrige](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/lint-and-fix.gif)

- As mesmas regras do [markdownlint](https://github.com/DavidAnson/markdownlint) que a pipeline roda, com
  o `.markdownlint.{jsonc,json,yaml,yml}` do seu repositório, verificadas enquanto você digita.
- Problemas no painel **Problemas** e no editor visual, explicados em linguagem simples ("Há mais de um
  Título 1 na página") em vez de códigos de regra.
- **Ajustar agora:** um botão no editor visual, uma correção rápida (lâmpada) no texto e o
  `source.fixAll.techdocs` para corrigir ao salvar.
- **Ver linha:** o número da linha ao lado de cada bloco abre o texto Markdown ali mesmo.

### Imagens vão para onde o MkDocs espera

![Inserir uma imagem do computador: ela é gravada em docs/assets e o link é relativo à página](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/images.gif)

Escolha uma imagem do computador e ela é gravada em `docs/assets/<horário>-<nome>`, com o link relativo à
página. Nunca um endereço temporário `blob:`, e nunca maior do que você permitir
(`techdocsEditor.images.maxSizeMB`).

### Para se achar

![Ctrl+F no editor visual destaca e conta os resultados](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/search.gif)

- **TechDocs na barra de atividades:** um ícone próprio, que só aparece em workspaces com `mkdocs.yml`, para o
  resto do seu Markdown não atrapalhar. Ele tem três seções: **Documentação**, **Verificação** e o painel
  opcional **Publicação**. Num repositório ainda sem `mkdocs.yml`, mas com `README.md`, uma pasta `docs/` com
  páginas ou um `catalog-info.yaml`, o ícone abre uma tela de boas-vindas que diz o que achou, com **Preparar a
  documentação**.
- **Árvore Documentação:** as páginas de cada site do MkDocs do workspace, na ordem do `nav` do `mkdocs.yml`
  (ou das pastas, sem `nav`), com o título de cada página. Páginas fora do `nav` e itens do `nav` que apontam
  para páginas que não existem aparecem marcados.
- **Só nas páginas das docs:** o botão e o comando **Abrir no editor visual** aparecem para páginas dentro de um
  `docs_dir`, não para todo arquivo Markdown (READMEs, changelogs).
- **Busca** com Ctrl+F no editor visual, com "1 de 3" e Enter / Shift+Enter entre os resultados.

### Começar de um template

![Nova página a partir de uma seção da árvore Documentação: escolha o tipo de página, dê um título, e ela abre no editor visual pronta para preencher](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/new-page.gif)

**TechDocs: Nova página a partir de template…** (paleta de comandos, o **+** num site ou seção da árvore
**Documentação** ou clique direito numa pasta das docs) cria uma página com as seções que aquele tipo de página precisa, já com o título, a data
e o dono do `catalog-info.yaml`, e abre no editor visual.

| Para… | Templates |
|-------|-----------|
| Aprender | Tutorial, Onboarding, Golden path |
| Fazer uma tarefa | Guia, Runbook, Solução de problemas |
| Consultar | Página inicial do serviço, Operação e suporte, Referência de API, Página de wiki |
| Entender | Arquitetura, Registro de decisão de arquitetura (numerado: `adr/0001-…`), Postmortem |

O nome do arquivo sai do título, nunca sobrescreve uma página existente e nunca sai da pasta das docs. Os
templates seguem a língua do VS Code (inglês ou português), passam na verificação de formatação e abrem no
editor visual sem nenhuma alteração. Num site com `nav`, a página já pode entrar nele, na seção clicada na
árvore; só essa linha é acrescentada ao `mkdocs.yml`.

#### Como os templates evoluem

| Camada | Onde | Como muda |
|--------|------|-----------|
| Da extensão | Esta extensão | Versão nova da extensão, atualizada automaticamente pelo Marketplace |
| Da empresa ou do time | `.techdocs/templates/` no repositório das docs (ou na pasta do site, que vale mais) | Pull request nesse repositório: nada a publicar |
| Da empresa inteira | Um repositório do GitHub com os templates de todos os repositórios de docs (`techdocsEditor.templates.repository`) | Pull request nesse repositório: chega a todos em até uma hora |

Um template é uma página Markdown com um bloco `template:` no front matter. Os do repositório aparecem
primeiro na lista e substituem o da extensão de mesmo nome de arquivo (`runbook.md`). Outras pastas vão em
`techdocsEditor.templates.paths`, e `techdocsEditor.templates.builtIn: false` oferece só os seus. Páginas já
criadas nunca mudam quando o template muda.

Os templates da empresa ficam numa pasta de um repositório do GitHub, no mesmo formato, e vêm entre os do
repositório e os da extensão. Aponte `techdocsEditor.templates.repository` para `dono/repo`, com a pasta e uma
branch ou tag opcionais (`acme/docs-templates/templates@v3`; com tag, você escolhe quando atualizar), e o host no
GitHub Enterprise (`ghe.acme.com/acme/docs-templates`). A extensão tenta primeiro sem login (repositório
público) e só pede o login do GitHub se precisar. Confere no máximo uma vez por hora, guarda uma cópia para usar
sem rede, e **TechDocs: Atualizar os templates da empresa** confere na hora.

```markdown
---
template:
  version: 1
  name: Runbook
  description: Responder a um alerta
  category: guide        # tutorial | guide | reference | explanation
  folder: runbooks
  fields:
    alert:
      prompt: Nome do alerta
---

# {{title}}

Alerta: {{alert}}. Dono: {{owner}}. Revisado em {{date}}.
```

#### Um site de documentação inteiro

![Novo site de documentação a partir de template: dê o nome, responda às perguntas, e o mkdocs.yml e as páginas ficam prontos](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/new-site.gif)

**TechDocs: Novo site de documentação…** (paleta de comandos, menu da seção Documentação ou clique direito numa
pasta) e **Criar a documentação** na barra lateral abrem uma **prévia** na barra lateral TechDocs, antes de
gravar qualquer coisa:

- **No topo:** o template, o nome do site (sugerido pelo título do README) e o dono (do `catalog-info.yaml` ou
  do `CODEOWNERS`), cada um dizendo de onde veio a sugestão. O dono só é obrigatório enquanto o
  `catalog-info.yaml` vai ser criado.
- **Arquivos ou Menu:** desmarque o que não quer; em **Menu**, arraste (ou use as setas ou Alt+↑/↓) para mudar
  a ordem e dê dois cliques (ou F2) para renomear. **+ Página** pede o caminho em Arquivos e o título em Menu,
  com o tipo da página (tutorial, guia prático, ADR…); **+ Seção** cria um grupo no menu.
- **O que já existe:** uma página de `docs/` que o template também traz pede **Manter o atual** ou **Usar o do
  template**; o README pode ser copiado, movido ou não usado.
- Clique num arquivo para ver o texto. **Criar** grava o `mkdocs.yml` (com o `nav` e o plugin
  `techdocs-core`), as páginas e o `catalog-info.yaml` com a anotação do TechDocs; nunca sobrescreve um arquivo.

![Repositório só com README: a tela de boas-vindas, o README como página inicial e a pergunta do catalog-info.yaml](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/prepare-readme.gif)

- **O README como página inicial:** ao lado de um `README.md`, escolha **Copiar para docs/index.md**, **Mover
  para docs/index.md** (o README fica com um link para as docs) ou não usar. Links para `docs/…` passam a ser
  relativos à pasta das docs.
- **As páginas que você já tem:** com páginas em `docs/` e sem `mkdocs.yml`, **Usar as páginas que já existem**
  cria só o `mkdocs.yml`, com o `nav` pelas pastas e títulos das páginas e o plugin `techdocs-core`, mostrado
  num diff antes. Nenhuma página muda.
- **Uma pergunta só:** sem `catalog-info.yaml`, pergunta se o seu Backstage usa um no repositório. **Não** faz a
  extensão parar de falar nele; **Sim** leva à Verificação, que oferece criá-lo. A resposta vai para o
  `.techdocs-editor.yaml`, para o time todo.

![Páginas em docs/ sem mkdocs.yml: usá-las, e só o mkdocs.yml é criado, com o nav pelas pastas e títulos](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/adopt-docs.gif)

| Site | Páginas |
|------|---------|
| Docs de serviço | Página inicial do serviço, Arquitetura, Operação e suporte e o primeiro ADR |
| Wiki de time | Início (como usar a wiki), Onboarding, Guias, uma página de wiki de exemplo |
| Golden path | Visão geral, tutorial de primeiros passos, Solução de problemas |

Os seus templates de site são pastas em `.techdocs/templates/` com um `template.yml`: cada arquivo vem de um
template de página (`page`, seu ou da extensão) ou de um arquivo da pasta (`source`).

```yaml
version: 1
name: Serviço da plataforma
description: Docs de um serviço da nossa plataforma
fields:
  squad:
    prompt: Squad
files:
  - path: index.md
    title: "{{site_name}}"
    source: inicio.md        # .techdocs/templates/servico-plataforma/inicio.md
  - path: runbooks/deploy-falhou.md
    title: Deploy falhou
    section: Runbooks        # um grupo no nav
    page: runbook            # um template de página
```

### Conferir e preparar o repositório

![A seção Verificação agrupa por tipo o que o TechDocs precisa; um clique leva à linha; Corrigir mostra o diff antes de aplicar](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/check-and-fix.gif)

A seção **Verificação** da barra lateral TechDocs lista, agrupado por tipo, o que falta ou está errado para o
TechDocs montar cada site: `site_name` e o plugin `techdocs-core` no `mkdocs.yml`, a pasta das docs e o
`index.md` dela, itens do `nav` que apontam para páginas que não existem e páginas fora do `nav`, a anotação
`backstage.io/techdocs-ref` no `catalog-info.yaml`, a configuração do markdownlint, problemas de formatação,
links para arquivos que não existem e imagens que faltam. Ela confere sozinha quando aparece pela primeira vez e
de novo depois que você salva; o ícone mostra quantos itens faltam. Um clique abre o arquivo na linha, e
**Corrigir** mostra o diff daquela correção antes de gravar qualquer coisa. Os mesmos itens ficam no painel
Problemas.

**TechDocs: Preparar a documentação neste repositório** cria um site de template quando não há `mkdocs.yml`.
Se há, passa pelas correções uma por uma, com o diff antes, para você aplicar, pular ou parar. Links quebrados
e imagens que faltam não têm correção: só uma pessoa sabe o destino certo.

Nem todo Backstage lê o `catalog-info.yaml` do repositório. A engrenagem da seção **Verificação** (**Opções da
verificação**) define como a verificação o trata: **Conferir só se existir** (o padrão; a falta do arquivo é só
uma dica, que não conta no ícone), **Exigir** (a falta é um problema, com uma correção que cria um mínimo) ou
**Não usar**. Grave **Para o time** no `.techdocs-editor.yaml` (`catalog:`) ou **Só para mim** na configuração
`techdocsEditor.catalog`; o arquivo do repositório vale sobre ela.

![A engrenagem da Verificação: não usar o catalog-info.yaml, gravado para o time, e a dica some](https://raw.githubusercontent.com/edtroleis/vscode-techdocs-editor/main/docs/media/check-options.gif)

### Editar a documentação no GitHub sem clonar

**TechDocs: Abrir documentação do GitHub…** aceita uma URL ou `dono/repo` (GitHub Enterprise Server também, com
`techdocsEditor.github.host`) e abre o site na árvore Documentação e a página inicial no editor visual, lidos
pela API do GitHub. Repositório público abre sem login; links como
`vscode://edtroleis.techdocs-editor/open?host=github.com&repo=acme/wiki&path=docs/index.md` são conferidos antes
de abrir qualquer coisa.

- **Ctrl+S salva o seu rascunho:** um commit na sua branch da página (`docs/<login>/<página>`), criada no
  primeiro salvar a partir da versão que você abriu, com `[skip ci]` onde há pipeline. Quem publicar antes de
  você nunca é sobrescrito. As imagens que você põe vão para `<docs>/assets/` nessa branch e aparecem no editor.
- **O painel Publicação** aparece nas páginas do GitHub, com os mesmos botões do modo local: **Salvar e
  verificar** roda a pipeline e abre um pull request em rascunho, **Enviar** marca como pronto, **Descartar**
  apaga o rascunho. Quando o merge é feito no GitHub, o painel diz que a página foi publicada.
- Sem login, ou sem permissão de escrita, as páginas ficam só leitura; **Entrar no GitHub** no painel reabre a
  página do seu rascunho, pronta para editar.

### Publicar sem sair do VS Code (opcional)

Para quem prefere não lidar com branches e pull requests: ligue `techdocsEditor.local.publishPanel` e um
painel **Publicação** aparece na barra lateral TechDocs, com o mesmo fluxo do plugin do Backstage.

| Botão | O que acontece no GitHub |
|-------|--------------------------|
| **Salvar rascunho** | Commit e push na branch do rascunho, com `[skip ci]`: sem verificações e sem pull request |
| **Salvar e verificar** | Ajusta o que a verificação de formatação sabe ajustar, faz commit e push e abre um pull request **em rascunho** na primeira vez, o que dispara as verificações |
| **Enviar para publicação** / **Enviar para revisão** | Marca o pull request como pronto. Quem publica é quem faz o merge no GitHub: o painel nunca faz merge |
| **Descartar** | Fecha o pull request e, numa branch criada pelo painel, apaga a branch aqui e no GitHub |

- Na branch principal, salvar cria `docs/<seu-login>/<página>` e troca para ela. Numa branch sua, o painel usa
  essa branch.
- Os commits levam só a página e as imagens novas de `assets/` que ela usa, nunca outras alterações do
  workspace.
- As verificações de qualquer CI (check runs do GitHub Actions e commit statuses), com as falhas em
  linguagem simples e link para a linha. Sem pipeline, a verificação é a de formatação do editor.
- Quem administra o repositório vê **Configurar verificações**: um workflow com as verificações padrão, as
  regras de formatação e a proteção da branch, com os arquivos num pull request para o time revisar.
- O login é a conta do GitHub do VS Code (GitHub Enterprise Server também). O token fica com o VS Code.

## Como começar

1. Instale o **TechDocs Editor** pelo Marketplace do VS Code.
2. Abra uma pasta que tenha um `mkdocs.yml` (a extensão começa sozinha ali). Ainda sem `mkdocs.yml`? O ícone
   TechDocs também aparece ao lado de um `README.md`, de uma pasta `docs/` ou de um `catalog-info.yaml`, com
   **Preparar a documentação**.
3. Abra uma página:
   - pela seção **Documentação** do ícone TechDocs na barra de atividades, ou
   - pelo botão **Abrir no editor visual** na barra de título de um arquivo `.md`, ou
   - por **Reabrir Editor com… → Editor visual do TechDocs**.

Primeira vez? **Ajuda → Bem-vindo → Comece com o TechDocs Editor** passa por criar um site, a barra lateral, uma
página nova, o editor visual, a verificação, a publicação e os templates da empresa.

Para abrir as páginas de documentação sempre no editor visual, ligue `techdocsEditor.openVisualByDefault`.
Use **Reabrir Editor com…** ou **TechDocs: Abrir como texto Markdown** para ver o texto.

## Configurações

| Configuração | Padrão | O que faz |
|--------------|--------|-----------|
| `techdocsEditor.openVisualByDefault` | `false` | Abre as páginas do `docs_dir` de um MkDocs no editor visual em vez do texto |
| `techdocsEditor.images.maxSizeMB` | `5` | Maior imagem que o editor visual grava em `assets`. As imagens vão para o repositório: arquivos grandes pesam em todo clone |
| `techdocsEditor.templates.paths` | `[]` | Mais pastas com templates de página e de site, relativas à pasta do workspace (o `.techdocs/templates/` é sempre lido) |
| `techdocsEditor.templates.repository` | `""` | Templates da empresa num repositório do GitHub: `dono/repo[/pasta][@ref]` |
| `techdocsEditor.templates.builtIn` | `true` | Oferece os templates que vêm com a extensão |
| `techdocsEditor.catalog` | `auto` | Como a verificação trata o `catalog-info.yaml`: `auto` (confere só se existir), `required` ou `off`. Também pela engrenagem da seção Verificação; o `catalog:` do `.techdocs-editor.yaml` vale sobre esta |
| `techdocsEditor.local.publishPanel` | `false` | Mostra o painel **Publicação** |
| `techdocsEditor.branchPattern` | `docs/{login}/{path}` | Branch criada para o rascunho quando você está na branch principal |
| `techdocsEditor.drafts.skipCi` | `true` | **Salvar rascunho** põe `[skip ci]`, para a pipeline rodar só em **Salvar e verificar** |
| `techdocsEditor.verification.mode` | `auto` | `auto` (a pipeline, quando há uma), `pipeline` ou `editor` |
| `techdocsEditor.verification.startTimeoutSeconds` | `120` | Espera pela primeira verificação antes de avisar que nada começou |
| `techdocsEditor.verification.checkHelp` | `{}` | Mensagem em linguagem simples por nome de check, mostrada quando ele falha |
| `techdocsEditor.polling.intervalSeconds` / `idleIntervalSeconds` | `8` / `60` | Consultas às verificações com algo rodando / parado. Nada é consultado com a janela em segundo plano |
| `techdocsEditor.mode` | `auto` | Onde abre a documentação de um repositório do GitHub: `auto` (você escolhe quando ele também está no workspace), `local` ou `remote` |
| `techdocsEditor.github.host` | `""` | O GitHub Enterprise Server da empresa, ex.: `github.example.com`, além do `github.com` |
| `techdocsEditor.github.scopes` | `["repo"]` | Escopos pedidos no login do GitHub (`public_repo` para repositórios públicos) |

Um `.techdocs-editor.yaml` na raiz do repositório (`verification.mode`, `startTimeoutSeconds`, `checkHelp`)
vence as configurações, para o time inteiro ter as mesmas verificações.

Corrigir a formatação ao salvar:

```jsonc
"[markdown]": {
  "editor.codeActionsOnSave": { "source.fixAll.techdocs": "explicit" }
}
```

## Comandos

| Comando | O que faz |
|---------|-----------|
| **TechDocs: Abrir no editor visual** | Abre o arquivo `.md` atual no editor visual |
| **TechDocs: Abrir como texto Markdown** | Abre o texto da página ao lado do editor visual |
| **TechDocs: Nova página a partir de template…** | Cria uma página de documentação a partir de um template e abre no editor visual |
| **TechDocs: Novo site de documentação…** | Cria o `mkdocs.yml` e as páginas de um site de documentação a partir de um template |
| **TechDocs: Conferir a documentação do repositório** | Lista na seção Verificação e no painel Problemas o que falta ou está errado para o TechDocs |
| **TechDocs: Preparar a documentação neste repositório** | Cria um site, ou aplica as correções da conferência uma por uma, com o diff antes |
| **TechDocs: Abrir documentação do GitHub…** | Abre um site de um repositório do GitHub sem clonar (URL ou `dono/repo`) |
| **TechDocs: Atualizar os templates da empresa** | Confere o repositório de templates da empresa na hora, sem esperar a conferência de cada hora |

## Onde o lint acha a configuração

Para cada página, a extensão procura `.markdownlint.jsonc`, `.json`, `.yaml` ou `.yml` da pasta do
`mkdocs.yml` da página até a pasta do workspace e usa o primeiro que encontrar (senão, o padrão do
markdownlint). Só as páginas de um `docs_dir` são verificadas.

- **Modo restrito:** num workspace não confiável, a configuração do repositório não é lida e as páginas
  não são verificadas até você confiar na pasta.
- **Com a [extensão do markdownlint](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint)
  instalada,** os diagnósticos dela valem no painel Problemas, para você não ver cada problema duas vezes.
  O editor visual continua mostrando a lista.

## Privacidade e segurança

- **Sem telemetria.** A extensão não coleta nada.
- **Sem rede no modo local**, a não ser que você ligue o painel de publicação. As páginas são lidas e
  gravadas pelo VS Code; os únicos acessos são às imagens que as suas páginas já apontam com `https://`. O
  painel só fala com o GitHub do remote do seu repositório, a partir do host da extensão: o token nunca chega
  ao webview. Com `techdocsEditor.templates.repository` configurado, a extensão também lê esse repositório, no
  máximo uma vez por hora; em workspace não confiável, só vale a sua configuração de usuário, nunca a da pasta.
- **O modo remoto** fala só com o GitHub do repositório que você abriu. A lista de sites abertos guarda só o
  host, `dono/repo` e a pasta do `mkdocs.yml`, nunca token.
- O editor visual roda num webview com política de segurança de conteúdo restrita: só os scripts da
  própria extensão rodam.

## Requisitos e limitações

- VS Code 1.100 ou mais novo.
- Funciona em pastas locais e clones (modo local). O Git continua com o controle de versão do VS Code.
- No modo local, o painel de publicação precisa de um clone com remote do GitHub e da extensão Git do VS Code.
- Modo remoto, ainda não: resolver uma página que mudou no GitHub enquanto você editava (por enquanto, feche e
  abra de novo), o histórico da página, o aviso de pull request de outra pessoa na mesma página, páginas novas
  por template e o VS Code para a Web. Veja o [plano](specs/00-visao-geral.md#fases).
- Fórmulas (LaTeX) ficam desligadas, como na configuração padrão do MkDocs do TechDocs.
- Algumas construções avançadas do Material for MkDocs, como grid cards e blocos HTML com `markdown`, ainda
  estão sendo reforçadas. Confira o diff antes de commitar páginas que as usam.

## Contribuir

Relatos de bugs e pull requests são bem-vindos. Veja o [CONTRIBUTING.md](CONTRIBUTING.md) para o ambiente de
desenvolvimento e os testes.

## Licença

[Apache-2.0](LICENSE).
