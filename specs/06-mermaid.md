# 06 — Diagramas Mermaid

## Problema

Diagramas de arquitetura, fluxos e sequências são comuns na documentação técnica, e o Mermaid é o formato que
cabe no Markdown (texto no próprio arquivo, revisável no Git). Hoje um bloco ` ```mermaid ` aparece no editor
visual como código comum: quem escreve não vê o diagrama, não tem como inserir um sem saber a sintaxe e não sabe
se ele está certo. No site, o MkDocs também mostra só o código, a não ser que o `mkdocs.yml` e o Backstage estejam
preparados.

## Objetivo

Escrever, ver e corrigir diagramas Mermaid no editor visual, sem rede (também no vscode.dev), e deixar o
`mkdocs.yml` pronto para o site desenhar.

Fora do escopo (decisão de 2026-11-04): PlantUML; prévia no editor de texto Markdown do VS Code; editor gráfico
de diagramas (arrastar caixas); exportar o diagrama como imagem.

## Decisões

- **Formato no arquivo:** bloco de código cercado com a linguagem `mermaid`, como já é hoje. Nada muda no
  Markdown salvo: abrir e salvar uma página com diagrama não altera o texto.
- **Desenho no editor:** a prévia nativa do bloco de código do Crepe (`renderPreview` da feature CodeMirror,
  Crepe 7.22), não um tipo de bloco próprio. A biblioteca `mermaid` vai no pacote da webview, num pedaço separado
  carregado só quando a página tem o primeiro diagrama (é grande, ~2–3 MB).
- **No site:** `pymdownx.superfences` com o bloco personalizado `mermaid` (`<pre class="mermaid">`). O
  `techdocs-core` (conferido na 1.7.1) já carrega o superfences pelo `pymdownx.extra` e junta o
  `mdx_configs` do `mkdocs.yml` ao dele, então basta a configuração no `mkdocs.yml`. Não usar o
  `mkdocs-mermaid2-plugin`: ele injeta um script que o TechDocs do Backstage remove.
- **Backstage:** o diagrama só aparece no Backstage com o addon de Mermaid do TechDocs instalado pelo admin. A
  extensão não depende do Backstage: só explica isso no texto do achado do Conferir.

## Itens

| Id | Parte | O que faz | Estado |
|----|-------|-----------|--------|
| M1 | Editor visual | Bloco `mermaid` mostra o diagrama no lugar do código. **Editar** no bloco mostra o código com a prévia embaixo; **Ver diagrama** volta. Editar o código redesenha (os desenhos saem um de cada vez, na ordem). Todo bloco começa no diagrama, inclusive o recém-inserido (o Crepe só tem a opção para todos os blocos). Os botões do bloco de código (Copiar, Prévia) ficam no idioma da pessoa | ✅ |
| M2 | Editor visual | Tema do diagrama segue o do VS Code: `dark` no escuro e alto contraste escuro, `default` no claro; troca de tema redesenha os diagramas abertos | ✅ |
| M3 | Editor visual | Erro de sintaxe: no lugar do diagrama, a mensagem do Mermaid (linha, quando vier) com a cor de erro do tema; o código continua editável e o arquivo é salvo como está | ✅ |
| M4 | Inserir | "Diagrama (Mermaid)" no menu `/` e na barra (no grupo do bloco de código), com um fluxograma curto de exemplo (`flowchart LR`, três caixas) e o cursor no código. Rótulos em pt-BR e inglês, como os outros | ✅ |
| M5 | Problemas | Erros de sintaxe dos diagramas da página aberta no editor visual vão para o painel Problemas (fonte `TechDocs`, linha do bloco + linha do erro), validados pelo mesmo Mermaid da webview e enviados ao host. Some ao corrigir ou fechar a página. Páginas fechadas e o Conferir não validam diagramas (precisariam do Mermaid no host) | ✅ |
| M6 | Conferir | Achado `mermaid-config-missing` (aviso, só quando alguma página do site tem bloco `mermaid` e o `mkdocs.yml` não tem o bloco personalizado no `pymdownx.superfences`). Ajuste automático acrescenta a configuração abaixo em `markdown_extensions` (cria a lista se faltar; junta se o `pymdownx.superfences` já existe com outras opções), com Desfazer, preservando as tags do MkDocs. O texto do achado avisa que no Backstage é preciso o addon de Mermaid do TechDocs | ✅ |
| M7 | Inserir | Ao inserir o primeiro diagrama (M4) numa página de um site sem a configuração, a mesma configuração do M6 é acrescentada ao `mkdocs.yml` com uma mensagem e Desfazer | ✅ |
| M8 | Navegador | Funciona no vscode.dev: o Mermaid desenha na webview sem rede; a CSP atual (`style-src 'unsafe-inline'`, scripts com nonce) cobre o SVG e o pedaço carregado depois. Conferir no teste web | ✅ |

Configuração acrescentada (M6, M7):

```yaml
markdown_extensions:
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
```

## Conferido antes de implementar (2026-11-04)

- O addon de Mermaid do TechDocs no Backstage pede a mesma configuração (`pymdownx.superfences` com `class: mermaid`):
  o M6 fica como aviso.
- `mkdocs build` com techdocs-core 1.7.1 e a configuração acima gera `<pre class="mermaid">`; os outros blocos de
  código continuam com realce.
- Mermaid 12.2.0: ~1,4 MB gzip a mais no `.vsix`, em pedaços carregados só com diagrama na página; a abertura do
  editor ficou em 459 KB gzip (orçamento de 500 KB).
- O `render` do Mermaid com erro de sintaxe deixa uma "bomba" de erro no `body`: o código é validado (`parse`)
  antes de desenhar.

## Testes

- Unitários (`core`): M6 (achado e ajuste: sem `markdown_extensions`, com a lista, com superfences sem e com
  outras opções, com tags `!!python/name` em outras chaves; sem achado quando não há diagrama).
- Editor no navegador (`npm run test:editor`): M1 (desenha, alterna, redesenha), M3 (erro mostrado e Markdown
  salvo igual), M4 (inserir pelo menu e pela barra).
- VS Code (`TEST_GREP`): M5 (diagnóstico aparece e some) e M7.
- Web (`test:web`): M8, uma página com diagrama desenha.
- Ida e volta: página com diagrama aberta e salva sem mudança no texto.
