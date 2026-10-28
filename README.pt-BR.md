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

- **Árvore Documentação** no Explorer: as páginas de cada site do MkDocs do workspace, na ordem do `nav` do
  `mkdocs.yml` (ou das pastas, sem `nav`), com o título de cada página. Páginas fora do `nav` e itens do
  `nav` que apontam para páginas que não existem aparecem marcados.
- **Busca** com Ctrl+F no editor visual, com "1 de 3" e Enter / Shift+Enter entre os resultados.

### Publicar sem sair do VS Code (opcional)

Para quem prefere não lidar com branches e pull requests: ligue `techdocsEditor.local.publishPanel` e um
painel **Publicação** aparece no Explorer, com o mesmo fluxo do plugin do Backstage.

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
2. Abra uma pasta que tenha um `mkdocs.yml` (a extensão começa sozinha ali).
3. Abra uma página:
   - pela seção **Documentação** do Explorer, ou
   - pelo botão **Abrir no editor visual** na barra de título de um arquivo `.md`, ou
   - por **Reabrir Editor com… → Editor visual do TechDocs**.

Para abrir as páginas de documentação sempre no editor visual, ligue `techdocsEditor.openVisualByDefault`.
Use **Reabrir Editor com…** ou **TechDocs: Abrir como texto Markdown** para ver o texto.

## Configurações

| Configuração | Padrão | O que faz |
|--------------|--------|-----------|
| `techdocsEditor.openVisualByDefault` | `false` | Abre as páginas do `docs_dir` de um MkDocs no editor visual em vez do texto |
| `techdocsEditor.images.maxSizeMB` | `5` | Maior imagem que o editor visual grava em `assets`. As imagens vão para o repositório: arquivos grandes pesam em todo clone |
| `techdocsEditor.local.publishPanel` | `false` | Mostra o painel **Publicação** |
| `techdocsEditor.branchPattern` | `docs/{login}/{path}` | Branch criada para o rascunho quando você está na branch principal |
| `techdocsEditor.drafts.skipCi` | `true` | **Salvar rascunho** põe `[skip ci]`, para a pipeline rodar só em **Salvar e verificar** |
| `techdocsEditor.verification.mode` | `auto` | `auto` (a pipeline, quando há uma), `pipeline` ou `editor` |
| `techdocsEditor.verification.startTimeoutSeconds` | `120` | Espera pela primeira verificação antes de avisar que nada começou |
| `techdocsEditor.verification.checkHelp` | `{}` | Mensagem em linguagem simples por nome de check, mostrada quando ele falha |
| `techdocsEditor.polling.intervalSeconds` / `idleIntervalSeconds` | `8` / `60` | Consultas às verificações com algo rodando / parado. Nada é consultado com a janela em segundo plano |
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
  ao webview.
- O editor visual roda num webview com política de segurança de conteúdo restrita: só os scripts da
  própria extensão rodam.

## Requisitos e limitações

- VS Code 1.100 ou mais novo.
- Funciona em pastas locais e clones (modo local). O Git continua com o controle de versão do VS Code.
- O painel de publicação precisa de um clone com remote do GitHub e da extensão Git do VS Code.
- Ainda não: o modo remoto (editar um repositório do GitHub sem clonar), o VS Code para a Web e os templates
  de documentação. Veja o [plano](specs/00-visao-geral.md#fases).
- Fórmulas (LaTeX) ficam desligadas, como na configuração padrão do MkDocs do TechDocs.
- Algumas construções avançadas do Material for MkDocs, como grid cards e blocos HTML com `markdown`, ainda
  estão sendo reforçadas. Confira o diff antes de commitar páginas que as usam.

## Contribuir

Relatos de bugs e pull requests são bem-vindos. Veja o [CONTRIBUTING.md](CONTRIBUTING.md) para o ambiente de
desenvolvimento e os testes.

## Licença

[Apache-2.0](LICENSE).
