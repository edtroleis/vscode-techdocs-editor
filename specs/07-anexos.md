# 07 — Anexos e diretórios de imagens

## Problema

A documentação de um serviço muitas vezes precisa de arquivos que não são imagens: o PDF de um contrato, a
planilha de capacidade, o `.drawio` da arquitetura, um `.zip` com exemplos. Hoje o editor visual só aceita
imagens: quem quer anexar outro arquivo precisa copiar para o repositório e escrever o link à mão. As imagens vão
sempre para `<docs>/assets/<data-hora>-<nome>`, um nome difícil de ler no Git e no link, sem como o time escolher
outro diretório.

## Objetivo

Anexar qualquer documento à página pelo editor visual, do mesmo jeito que se insere uma imagem, com imagens e
anexos em diretórios previsíveis (`images/` e `assets/` dentro do `docs_dir`) que o time pode mudar numa
engrenagem.

Fora do escopo: prévia do anexo dentro do editor (o PDF aparece como link); converter documentos (Word para
Markdown); anexos fora do `docs_dir` (o MkDocs só publica o que está nele); mover as imagens que já existem em
`assets/` para `images/`.

## Decisões (2026-11-05)

- **Diretórios padrão:** imagens em `<docs_dir>/images/`, os outros anexos em `<docs_dir>/assets/`. O caminho é
  relativo ao `docs_dir`; o link na página sai relativo à página. Imagens que já estão em `assets/` ficam onde
  estão e os links delas não mudam.
- **Nome do arquivo:** o nome original, sem acento, em minúsculas e com `-` no lugar de espaços e símbolos
  (`Manual do Cliente.pdf` → `manual-do-cliente.pdf`); a extensão fica em minúsculas. Já existe um arquivo com esse
  nome e outro conteúdo: `-2`, `-3`… antes da extensão. Já existe um com o mesmo conteúdo (SHA-256): o link aponta
  para ele e nada é copiado. Imagem colada sem nome (captura de tela): `imagem-AAAAMMDD-HHMM.png`. Vale também para
  as imagens: o prefixo de data e hora sai.
- **Na página:** um link Markdown comum, com o nome legível, o tipo e o tamanho:
  `[Manual do cliente (PDF, 2,3 MB)](../assets/manual-do-cliente.pdf)`. O nome legível vem do nome original (sem a
  extensão, `-` e `_` viram espaço, primeira letra maiúscula); o tamanho no formato da língua do VS Code. Imagem
  continua virando imagem (`![texto alternativo](../images/diagrama-de-rede.png)`).
- **Limites:** imagens até 5 MB (como hoje); outros anexos até 20 MB, só dos tipos permitidos. Tipos permitidos de
  fábrica: `pdf, doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp, rtf, csv, tsv, txt, json, yaml, yml, xml,
  drawio, svg, png, jpg, jpeg, gif, webp, zip, gz, tar`. Executáveis e scripts nunca entram, mesmo que alguém os
  ponha na lista: `exe, msi, bat, cmd, com, ps1, sh, bash, zsh, app, dmg, jar, vbs, scr, js, mjs, html, htm`.
- **Configuração:** no `.techdocs-editor.yaml` do repositório (vale para o time) ou nas configurações do VS Code
  (só para quem escolheu); o do repositório vale sobre as configurações, que valem sobre o padrão. Cada campo é
  resolvido sozinho (o time pode fixar só o diretório e deixar o limite para cada um). Valor inválido é ignorado,
  como os outros campos do arquivo.
- **Engrenagem** na barra de título da seção TechDocs, ao lado de Conferir, filtro, nova página e nova seção, como
  a engrenagem da verificação: mostra os valores de agora e de onde vêm, deixa trocar e pergunta "para o time" ou
  "só para mim". "Para o time" mostra o diff do `.techdocs-editor.yaml` antes de gravar.
- **Implementação:** o envio de imagens que já existe (`imageUpload.ts`) vira o serviço de anexos. As regras puras
  (nome, sufixo, conteúdo igual, caminho relativo, texto do link, tipos) ficam no `core`; a extensão lê a
  configuração e grava no disco (`workspace.fs`) ou no rascunho do GitHub.

```yaml
# .techdocs-editor.yaml
attachments:
  images: images          # diretório das imagens, relativo ao docs_dir
  imagesMaxSizeMB: 5
  files: assets           # diretório dos outros anexos
  filesMaxSizeMB: 20
  types: [pdf, docx, xlsx, pptx, csv, txt, zip, drawio]   # tipos permitidos dos anexos (sem a lista, os de fábrica)
```

Nas configurações do VS Code: `techdocsEditor.attachments.images`, `techdocsEditor.attachments.files`,
`techdocsEditor.attachments.filesMaxSizeMB` e `techdocsEditor.attachments.types`; o limite das imagens continua em
`techdocsEditor.images.maxSizeMB`.

## Itens

| Id | Parte | O que faz | Estado |
|----|-------|-----------|--------|
| AX1 | Núcleo | Regras puras: nome do arquivo a partir do original, sufixo `-2`/`-3`, nome de imagem colada sem nome, caminho no `docs_dir` e link relativo à página, texto do link (nome legível, tipo, tamanho na língua), tipo permitido (lista + executáveis sempre recusados), leitura e escrita da seção `attachments` do `.techdocs-editor.yaml` | ⬜ |
| AX2 | Configuração | Valores resolvidos por campo: repositório, depois configurações do VS Code, depois o padrão; com a origem de cada um (para a engrenagem). Os quatro campos novos em `package.json` com descrição em inglês e pt-BR | ⬜ |
| AX3 | Imagens | Imagens novas vão para o diretório de imagens com o nome original (decisões acima), reaproveitando a que tiver o mesmo conteúdo. Limite das imagens resolvido pela configuração (AX2) | ⬜ |
| AX4 | Anexar | Botão "Anexar arquivo" na barra do editor visual (ao lado do de imagem) e "Anexo" no menu `/`: abre o seletor de arquivos do sistema; o arquivo passa por tipo e tamanho, é gravado (ou reaproveitado) no diretório dos anexos e o link entra no cursor. Recusa com a razão e o que fazer ("Arquivos .exe não são aceitos", "O arquivo tem 34 MB; o limite é 20 MB: mude na engrenagem da seção TechDocs") | ⬜ |
| AX5 | Arrastar e colar | Soltar arquivos do computador ou do Explorer do VS Code na página, ou colar arquivos copiados (Ctrl+V): imagens viram imagens (AX3), o resto vira anexo (AX4), na ordem e no lugar onde caíram. Arquivo que já está no `docs_dir` (arrastado do Explorer) só ganha o link, sem cópia | ⬜ |
| AX6 | GitHub | No modo GitHub (página aberta do repositório, sem clone), anexos vão para a branch do rascunho como as imagens (spec 02, M6), com o mesmo nome e reaproveitamento; o link funciona no editor lendo da branch | ⬜ |
| AX7 | Engrenagem | "Opções dos anexos" na barra de título da seção TechDocs: lista diretório de imagens, tamanho máximo das imagens, diretório dos anexos, tamanho máximo dos anexos e tipos permitidos, cada um com o valor e a origem (repositório, configurações, padrão); trocar um abre a pergunta certa (caixa de texto validada ou lista de tipos com marcação); no fim, "Para o time" (diff do `.techdocs-editor.yaml`, depois grava) ou "Só para mim" (configurações do usuário) | ⬜ |
| AX8 | Conferir | Achado `attachment-unused` (aviso): arquivo nos diretórios de imagens e de anexos que nenhum `.md` do site nem o `mkdocs.yml` cita (protege logo, favicon e CSS extra). Ajuste automático apaga os arquivos, com Desfazer | ⬜ |
| AX9 | Navegador | Funciona no vscode.dev: seletor, arrastar, colar e gravar pelo `workspace.fs`, sem APIs de Node | ⬜ |
| AX10 | Documentação | README e README.pt-BR (anexos, diretórios, engrenagem), CHANGELOG, GIF de anexar um PDF; specs 01 (W9) e 02 (LC3, M6) apontam para esta | ⬜ |

## Conferir antes de implementar

- Se o arrastar de arquivos do sistema chega ao webview do editor visual no VS Code desktop e no vscode.dev
  (o VS Code segura o drop de arquivos do sistema em webviews em algumas versões; o Explorer manda `text/uri-list`).
- Se o colar de arquivos (`clipboardData.files`) chega ao webview em Windows, macOS e Linux.
- Tamanho máximo que a mensagem do webview para o host aguenta bem (20 MB em base64 são ~27 MB): se precisar, mandar
  em partes.
- Se o MkDocs e o TechDocs servem `.drawio`, `.zip` e `.pdf` de `docs/assets/` como download (o `techdocs-core`
  não filtra extensões).

## Testes

- Unitários (`core`): AX1 (nomes com acento, espaços, símbolos e sem extensão; sufixo; conteúdo igual; imagem sem
  nome; caminho relativo de páginas em subdiretórios; texto do link em inglês e pt-BR; executável recusado mesmo na
  lista; YAML com e sem a seção, com valores inválidos), AX2 (precedência por campo), AX8 (citado num `.md`, no
  `mkdocs.yml`, em nenhum).
- Webview (`test/webview`): AX4 e AX5 (botão, `/`, soltar e colar mandam os arquivos ao host; imagem e anexo
  inseridos no cursor; recusa mostrada).
- VS Code (`TEST_GREP`): AX3 e AX4 (arquivo gravado no diretório certo, reaproveitado, link certo), AX6 (no
  rascunho do GitHub falso), AX7 (respostas prontas: time e só para mim), AX8 (achado e Desfazer).
- Web (`test:web`): AX9, anexar um arquivo grava pelo `workspace.fs`.
- Cenário de usuário: anexar um PDF por arrastar, mudar o diretório na engrenagem para o time, anexar outro e ver o
  Conferir apontar o primeiro depois de apagar o link.
