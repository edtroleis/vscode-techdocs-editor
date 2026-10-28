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
- **Sem rede no modo local.** As páginas são lidas e gravadas pelo VS Code. Os únicos acessos são às
  imagens que as suas páginas já apontam com `https://`.
- O editor visual roda num webview com política de segurança de conteúdo restrita: só os scripts da
  própria extensão rodam.

## Requisitos e limitações

- VS Code 1.100 ou mais novo.
- Funciona em pastas locais e clones (modo local). O Git continua com o controle de versão do VS Code.
- Ainda não: o painel opcional de publicação (branch, pull request e verificações sem sair do VS Code), o
  modo remoto (editar um repositório do GitHub sem clonar), o VS Code para a Web e os templates de
  documentação. Veja o [plano](specs/00-visao-geral.md#fases).
- Fórmulas (LaTeX) ficam desligadas, como na configuração padrão do MkDocs do TechDocs.
- Algumas construções avançadas do Material for MkDocs, como grid cards e blocos HTML com `markdown`, ainda
  estão sendo reforçadas. Confira o diff antes de commitar páginas que as usam.

## Contribuir

Relatos de bugs e pull requests são bem-vindos. Veja o [CONTRIBUTING.md](CONTRIBUTING.md) para o ambiente de
desenvolvimento e os testes.

## Licença

[Apache-2.0](LICENSE).
