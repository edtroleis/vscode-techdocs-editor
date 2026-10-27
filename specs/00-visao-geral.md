# 00 — Visão geral: editor de TechDocs no VS Code

## Problema

O plugin do Backstage ([backstage-plugin-techdocs-editor](https://github.com/edtroleis/backstage-plugin-techdocs-editor))
resolve a edição para quem está no portal. Fica de fora quem escreve docs dentro do VS Code (devs,
tech writers, quem usa Dev Spaces) e quem quer editar uma doc sem abrir o portal. Hoje essas
pessoas editam o Markdown cru, sem o visual, sem a ponte MkDocs e sem o lint com as regras da
pipeline, e só descobrem os problemas quando a pipeline reprova.

## Objetivo

Uma extensão do VS Code com o **mesmo editor visual do plugin** e dois modos:

| Modo | Para quem | Onde está o texto | Git |
|------|-----------|-------------------|-----|
| **Local** | Quem já tem o repositório clonado (VS Code desktop, Dev Spaces) | Arquivo do workspace | O do VS Code, à vista |
| **Remoto** | Quem não conhece Git | Repositório no GitHub, pela API | Escondido atrás de Salvar rascunho / Salvar e verificar / Enviar, como no plugin |

## Relação com a spec 00 da demo

A decisão D2 do `docs-editor-demo/specs/00-overview.md` descartou a extensão porque ela "expõe o VS
Code e o Git". Esta spec trata isso assim:

- no modo **local**, o público já usa VS Code e Git: não há o que esconder;
- no modo **remoto**, o Git fica escondido como no plugin, e a extensão roda também no **vscode.dev**
  (web extension), sem instalar nada. Sobra a "cara de VS Code", que é aceitável para quem chega
  pelo link "Abrir no VS Code" do portal (spec 02, R-integração), não para todo mundo;
- o plugin do Backstage continua sendo o caminho principal para o público não técnico.

A D6 da demo (núcleo do editor isolado para servir também uma extensão do VS Code) vira a fase 1
desta spec, feita neste repositório. **Primeiro a extensão**: o plugin do Backstage não é alterado
até a fase 7.

## Decisões de arquitetura

| # | Decisão | Escolha | Motivo |
|---|---------|---------|--------|
| X1 | Uma ou duas extensões | **Uma**, com os dois modos | Editor, ponte MkDocs, lint, checks e textos são os mesmos; duas extensões dobrariam as releases e mostrariam dois editores para o mesmo `.md`. Experiências diferentes por público se resolvem com perfil do VS Code ou extension pack sobre a mesma extensão |
| X2 | Núcleo compartilhado com o plugin | Pacotes sem Backstage: `@edtroleis/techdocs-editor-core` (sem React) e `@edtroleis/techdocs-editor-ui` (React + Milkdown + CodeMirror) | Hoje o editor visual mora no pacote do frontend do plugin, junto com o Backstage. Sem extrair, as correções (cursor de lista, CSS, imagens) divergem entre plugin e extensão |
| X3 | Onde ficam os pacotes do núcleo | **Neste repositório** (`packages/core`, `packages/ui`), copiados do plugin sem o Backstage; o plugin não muda agora | Foco na extensão: nenhuma dependência de release do plugin. Depois que a extensão estiver publicada, o plugin pode passar a consumir os pacotes (fase futura), e as correções voltam a ter um lugar só. Até lá, correção feita aqui no editor é anotada para levar ao plugin |
| X4 | Editor | `CustomTextEditorProvider` sobre o `TextDocument` do VS Code, nos **dois** modos | Desfazer, "não salvo", hot exit, salvar e comparar ficam nativos. No modo remoto, o documento vem de um `FileSystemProvider` próprio (spec 02, M2) |
| X5 | Visão Markdown | O **editor de texto nativo** do VS Code ("Reabrir com…", lado a lado) | Substitui a visão CodeMirror do plugin (F20/F21/F23): números de linha, busca e substituição já existem. O CodeMirror fica só no plugin |
| X6 | Autenticação | `vscode.authentication.getSession('github' \| 'github-enterprise', …)` | Sem OAuth App próprio (dor do plugin: callback fixa host e porta); o token é da pessoa e o RBAC do GitHub continua valendo |
| X7 | Merge | **Nunca** pela extensão | Mesma regra do plugin (F6): o merge é feito no GitHub por quem revisa |
| X8 | Configuração por repositório | O mesmo `.techdocs-editor.yaml` do plugin | O time descreve a pipeline uma vez, para o portal e para o VS Code |
| X9 | Distribuição | VS Code Marketplace **e** Open VSX | Dev Spaces, code-server e VSCodium usam o Open VSX |

## Premissas (herdadas da demo)

- Docs como código: MkDocs + TechDocs, repositórios no GitHub (github.com ou Enterprise).
- Todo merge na `main` por PR, com squash e a descrição do PR como mensagem (lição do `[skip ci]`
  que chegou à `main`, F6 da demo).
- Quem edita tem conta no GitHub.

## Especificações

| Spec | Assunto |
|------|---------|
| [01](01-editor-e-nucleo.md) | Núcleo compartilhado, editor no webview, fidelidade do Markdown e lint |
| [02](02-modos-e-publicacao.md) | Modo local, modo remoto, escolha do modo, autenticação, fluxo de publicação, configuração, integração com o Backstage |
| [03](03-qualidade-seguranca-release.md) | Testes, segurança, desempenho, versões fixas e release |

## Fases

| Fase | Entrega | Critério de pronto |
|------|---------|--------------------|
| 0. **Prova técnica** | Webview com o Milkdown sobre `CustomTextEditorProvider`, abrindo páginas reais | Abrir e salvar sem editar deixa as páginas da wiki idênticas byte a byte; digitar logo após criar item de lista não troca letras; a mesma extensão sobe no `@vscode/test-web` |
| 1. **Trazer o núcleo** | `packages/core` e `packages/ui` neste repositório, copiados do `-common` e do frontend do plugin, sem Backstage (spec 01, N1 a N5), com os testes do editor do plugin (harness Playwright) | Suítes do editor herdadas verdes aqui; o plugin não muda |
| 2. **Modo local (MVP)** | Editor visual, imagens em `assets/`, lint com diagnostics e correções automáticas, "ver linha" no editor nativo | Spec 01 e modo local da spec 02 cobertos pelos testes |
| 3. **Publicação no modo local** | Painel opcional: branch, PR em rascunho, checks em linguagem simples, enviar | Cenários de pipeline da spec 02 com o GitHub simulado |
| 4. **Modo remoto (desktop)** | `FileSystemProvider` do GitHub, Salvar rascunho / Salvar e verificar / Enviar / Descartar / Histórico, conflitos por SHA | Mesmos cenários do `test:editor:portal` do plugin, com o GitHub simulado |
| 5. **Web e Dev Spaces** | Build `browser` (vscode.dev), Open VSX, devfile de exemplo | Suíte no `@vscode/test-web`; instalação no Dev Spaces |
| 6. **Publicar** | Marketplace + Open VSX, README com GIFs, changelog | Release automatizada, pacote verificado |
| 7. **Depois: plugin** (fora do foco atual) | Publicar `core`/`ui` no npm, o plugin passa a consumi-los, e "Abrir no VS Code" no lápis do plugin (spec 02, B2) | Suítes do plugin verdes, sem mudança de comportamento |

## Pontos em aberto

| # | Ponto | Como fechar |
|---|-------|-------------|
| A1 | Organizações com restrição de OAuth Apps precisam aprovar o app de autenticação do VS Code | Testar numa organização com a restrição ligada (fase 4); documentar o pedido ao admin |
| A2 | No vscode.dev com um repositório aberto (`vscode-vfs`, extensão GitHub Repositories), usar o modo local sobre o FS virtual ou sempre o remoto | Prova na fase 5: o modo local ali expõe o controle de versão do VS Code, o que contraria o público do modo remoto |
| A3 | Abrir a extensão a partir de um link do vscode.dev já na página certa | Prova na fase 5 (o `vscode://` do desktop é garantido pelo `registerUriHandler`) |
| A4 | Abrir `.md` de docs no editor visual por padrão ou só por "Reabrir com…" | Padrão: visual no modo remoto, texto no modo local, com a configuração `techdocsEditor.openVisualByDefault` |

## Fase 0: resultado (2026-10-27)

**Feita.** Os três critérios passaram:

| Critério | Como foi conferido | Resultado |
|----------|--------------------|-----------|
| Abrir e salvar sem editar deixa as páginas idênticas | `roundtrip.spec.ts` (bundle do webview no Chromium) e a suíte de integração no VS Code desktop e web, nas 7 páginas das duas wikis de teste | 7/7 idênticas byte a byte; abrir não gera edição nem deixa o documento alterado |
| Cursor de lista não troca letras | `list-caret.spec.ts` (o teste do plugin, com quadros de animação atrasados), no bundle do webview | Passa com o `listCaretFix`; **reprova sem ele** (conferido tirando a correção) |
| Sobe no `@vscode/test-web` | `npm run test:web`: a mesma suíte do desktop no VS Code para navegador, com o host da extensão em web worker | 6/6 |

Também conferido:

- Ida e volta nas 136 páginas do PoC (`npm run roundtrip -- ../backstage/repos`): **43 idênticas**, igual à
  medição do plugin (spec 05 da demo, V3). As diferenças são as mesmas (tabelas realinhadas, URL solta
  vira `<url>`, indentação de continuação de lista, grid cards): o editor no webview se comporta como no
  portal.
- Edição no visual chega ao documento só no trecho alterado (`minimalEdit`), não com o arquivo inteiro.
- O comando **Desfazer** do VS Code volta o documento e o editor visual ao original.
- Mudança feita no editor de texto ao lado aparece no visual, e o visual recarregado não devolve nada ao
  documento.
- Arquivo com CRLF continua CRLF depois de editar.

Decisões e achados:

| # | Achado | Tratamento |
|---|--------|------------|
| R1 | O `init` mandado pelo host logo ao abrir se perdia na primeira abertura (o script do webview ainda não ouvia) | Handshake: o webview manda `loaded`, só então o host manda o conteúdo |
| R2 | O Mocha de navegador (UMD) troca o `module.exports` do bundle de testes, e o VS Code chamava o `run` do Mocha | Bundle web dos testes em IIFE, com `module.exports` definido no fim |
| R3 | Bundle do webview: 2,8 MB minificado (976 KB gzip). Maiores: linguagens do CodeMirror (~470 KB, `@codemirror/legacy-modes` + `@lezer/*`) e KaTeX (263 KB), importados pelo Crepe mesmo com LaTeX desligado | Cabe no limite de 5 MB do `.vsix`. Fase 2: bundle ESM com `splitting` (linguagens carregadas sob demanda) e tirar o KaTeX |
| R4 | `npm audit`: 4 avisos de severidade baixa no `katex` (vem do Crepe) | Some junto com o R3 |
| R5 | Não verificado automaticamente: **Ctrl+Z com o foco dentro do editor visual**. O ProseMirror tem desfazer próprio, e o VS Code também recebe a tecla: risco de desfazer duas vezes (W4 da spec 01) | **Resolvido**: o histórico é um só, o do documento do VS Code. Botões e Ctrl+Z/Y do visual mandam `undo`/`redo` ao host, que espera o painel ficar ativo antes do comando (o aviso de painel ativo chegava depois do clique e o desfazer se perdia). Coberto por `e2e/history.spec.ts` no VS Code de verdade |
| R6 | Mudança vinda de fora recria o editor visual (perde cursor e rolagem) | **Resolvido**: `setMarkdown` troca só o trecho diferente (`ui/src/externalContent.ts`); cursor, rolagem e histórico ficam |

Código: `packages/core` (por enquanto só `mkdocs.ts`, com os testes), `packages/ui` (editor do plugin sem
Material UI) e `packages/extension`. Mudanças no código que veio do plugin: `specs/para-o-plugin.md`.

Comandos (raiz): `npm run test:fast` (typecheck, unitários e webview, ~1 min), `npm run test:all` (tudo, inclusive o
VS Code de verdade); separados: `test:unit`, `test:webview`, `test:editor`, `test:vscode`, `test:web`, `test:e2e`
(Playwright dirigindo o VS Code desktop sem janela) e `npm run roundtrip -- <pasta>`. F5 no VS Code abre a extensão com as wikis de teste.

## Fase 2: plano (2026-10-27)

Modo local (MVP). Cada parte entra com os testes dela e um commit próprio; o critério da fase é a spec 01
e o modo local da spec 02 cobertos pelos testes. O painel de publicação (LC5) é a fase 3.

| Parte | Entrega | Requisitos | Testes |
|-------|---------|------------|--------|
| 2a. Modo local ✅ `40baeac` | Ativação por `mkdocs.yml`; páginas do `docs_dir` reconhecidas como docs; `techdocsEditor.openVisualByDefault` (padrão: texto no modo local, A4); arquivo com marcadores de conflito do Git não abre no visual, oferece o texto | LC1, LC2, LC4, A4 | unitários (detecção de página e de conflito); e2e |
| 2b. Lint ✅ | Diagnostics no painel Problemas, 400 ms depois de parar de digitar, com a configuração da raiz do repositório e textos em linguagem simples (pt-BR/en, das regras do plugin); code action "Ajustar agora"; no visual, marca nos blocos e lista com botão; sem diagnostics duplicados se a extensão `DavidAnson.vscode-markdownlint` estiver instalada; workspace não confiável: sem a configuração do repositório | L-1 a L-6, W11 | unitários; integração (diagnostics e code action); e2e |
| 2c. Ver linha ✅ | Número da linha no visual abre o texto nativo lado a lado na linha; problema no painel abre no texto | W12 | e2e |
| 2d. Imagens ✅ | Envio pelo visual grava `<docs>/assets/<timestamp>-<nome>` com `workspace.fs`, link relativo à página; só `image/*` até `techdocsEditor.images.maxSizeMB` (padrão 5, como o plugin); nunca `blob:`. Texto alternativo preservado (bug B3 do Crepe, ver `para-o-plugin.md`); imagem enviada leva o nome do arquivo como texto alternativo | W9, LC3 | unitários (caminho e limites); webview (mensagens, texto alternativo); integração (arquivo gravado e link, recusas); e2e (menu /, imagem na tela) |
| 2e. Busca no visual ✅ | Ctrl+F no visual com "N de M" (a barra do plugin, sem Material UI, em `ui/src/SearchBar.tsx`), no canto de cima como a busca do VS Code e com as cores dela; texto selecionado já vira a busca; o total acompanha as mudanças no texto | W10 | webview; e2e (o Ctrl+F chega ao visual) |
| 2f. Árvore "Documentação" ✅ | Seção "Documentação" no Explorer (só com `mkdocs.yml` no workspace): páginas do `docs_dir` pelo `nav` do `mkdocs.yml` (ou pastas, sem `nav`, na ordem do MkDocs), com o título da página (front matter ou título 1); página do `nav` que não existe com aviso; links do `nav`; grupo "Fora do nav"; um nó por site quando há mais de um; clicar abre a página (respeita `openVisualByDefault`), botão para abrir no visual; a página aberta fica selecionada. Lógica em `core/src/docsTree.ts` (o modo remoto reaproveita). Pasta de site apagada agora some dos sites (o VS Code avisa só a pasta) | LC6 | unitários (nav → árvore, títulos); integração (com e sem `nav`, título novo, site apagado); e2e |
| 2g. Bundle | Webview em ESM com `splitting` (linguagens do CodeMirror sob demanda) e sem KaTeX | R3, R4 | suítes inteiras; tamanho do bundle |

Pendente de conferência na 2b: a convivência com a extensão do markdownlint (L-6) e o workspace não confiável
não têm teste automático. Os dois dependem do ambiente: instalar outra extensão e abrir um workspace sem
confiança. Ficam para a fase 5, junto com o Dev Spaces.
