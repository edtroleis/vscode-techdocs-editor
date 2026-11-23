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
de diagramas com posição livre; exportar o diagrama como imagem. Montar fluxograma com o mouse, com layout
automático, entrou depois como passo futuro (ver M10 e M11).

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
| M9 | Pacote | O layout ELK (`elkjs`) volta ao pacote: sai o plugin `withoutElk` do `build.mjs` (~3,2 MB o `.vsix`); o orçamento da abertura (`test:bundle`) não muda: o ELK é um pedaço carregado só quando pedido. Diagrama com `layout: elk` sai com o ELK no editor; o site do TechDocs, que carrega o Mermaid sem o ELK, desenha com o dagre (anotado no `build.mjs`) | ✅ |
| M10 | Editor visual | **Clique duplo num texto do desenho leva ao código:** o bloco abre em Editar (aperta o botão do Crepe se está só no desenho), com o cursor no trecho e o texto selecionado; com o código aberto, o clique duplo leva a outra linha. Fluxograma: pelo id do nó no SVG (`flowchart-B-12` → nó `B`), seleciona o rótulo entre os colchetes, ou o id se não há rótulo; outros tipos e rótulos de seta: pelo texto (primeira linha depois da do tipo). Não achou: abre o código com o cursor no início, sem erro. Clique simples continua selecionando o bloco. Embaixo do desenho, a dica "Clique duas vezes num texto do desenho para editá-lo" (pt-BR e inglês). Nada acontece no modo leitura | ✅ |
| M11 | Inserir | **Cinco modelos** no menu `/`, no lugar do item único "Diagrama (Mermaid)": "Diagrama: fluxograma", "Diagrama: sequência", "Diagrama: estados", "Diagrama: cronograma (Gantt)" e "Diagrama: entidades", cada um com ícone e um exemplo curto, no idioma da pessoa (`messages/`). O menu do Crepe não tem descrição por item e só filtra pelo nome: o "Diagrama:" faz `/diagrama` achar os cinco. O botão da barra continua inserindo o fluxograma num clique (a barra não tem menus). O M7 vale para os cinco | ✅ |
| M12 | Editor visual | **Barra do nó:** clique simples num nó de um **fluxograma** (`flowchart`/`graph`) mostra, logo acima dele, os botões **+ Passo depois**, **+ Decisão**, **Ligar a…** e **Apagar** (pt-BR e inglês). Fecha com clique fora do nó, Esc ou depois de uma ação. Clique fora dos nós continua selecionando o bloco. Não aparece nos outros tipos de diagrama nem no modo leitura. Funciona no desenho só (bloco fechado) e na prévia do modo Editar. Embaixo dos fluxogramas, a dica vira "Clique num nó para acrescentar ou ligar; clique duas vezes num texto para editá-lo" (en: "Click a node to add or connect; double-click a text to edit it"); os outros diagramas ficam com a do M10 | ✅ |
| M13 | Editor visual | **+ Passo depois** e **+ Decisão** acrescentam uma linha no fim do código ligando o nó clicado a um nó novo: `  B --> N1[Novo passo]` ou `  B --> N1{Nova decisão?}` (en: "New step", "New decision?"). Id nova `N<k>`, o menor `k` sem uso. Recuo da última linha não vazia (2 espaços se não houver). Saindo de uma decisão (nó com forma `{…}`), a 1ª seta leva "Sim" e a 2ª "Não" (en: "Yes", "No"), a partir da 3ª sem rótulo: `  B -- Sim --> N1[Novo passo]`. Depois, o código abre com o texto do nó novo selecionado (como no M10) | ✅ |
| M14 | Editor visual | **Ligar a…:** a dica embaixo do desenho vira "Clique no nó de destino (Esc cancela)" e o próximo clique num nó acrescenta `  A --> B` (com a regra do Sim/Não do M13). Clique no mesmo nó, fora dos nós ou Esc cancela. Se a seta já existe, nada muda. O código não abre | ✅ |
| M15 | Editor visual | **Apagar:** tira o nó, as setas dele e as linhas `style`/`class`/`click` só dele; os outros nós e o resto de cada linha ficam (`A[x] --> B[y] --> C` sem `B` vira `A[x]` e `C`); linha que fica vazia sai. O código não abre | ✅ |
| M16 | Editor visual | **Nada quebra o diagrama:** cada ação (M13–M15) é uma só transação (um Ctrl+Z desfaz) e só é aplicada se o código novo passa no `parse` do Mermaid; se não passar (sintaxe que a edição automática não cobre, como `A & B --> C` ou subgrafos aninhados complexos), nada muda e aparece a mensagem "Não deu para mudar o diagrama automaticamente; edite o código" (en: "Couldn't change the diagram automatically; edit the code") | ✅ |
| M17 | Editor visual | **Arrastar de um nó a outro liga os dois:** no desenho de um fluxograma editável, apertar num nó, arrastar e soltar em outro nó do mesmo diagrama acrescenta `  A --> B`, com a regra do Sim/Não do M13. Se a seta já existe, nada muda. O código não abre | ✅ |
| M18 | Editor visual | **Arrastar de um nó a um espaço vazio do desenho cria um passo ligado a ele**, como **+ Passo depois** (M13), e abre o código com o nome selecionado. Soltar fora do desenho, no próprio nó, ou apertar Esc cancela | ✅ |
| M19 | Editor visual | **Durante o arrasto:** uma linha tracejada sai do nó até o ponteiro, o nó embaixo do ponteiro fica destacado, e a dica vira "Solte num nó para ligar, ou num espaço vazio para criar um passo (Esc cancela)" (en: "Drop on a node to connect, or on an empty space to add a step (Esc cancels)"). Menos de 5 px de movimento conta como clique (abre a barra, M12). A dica dos fluxogramas passa a ser "Clique ou arraste um nó para acrescentar e ligar; clique duas vezes num texto para editá-lo" (en: "Click or drag a node to add and connect; double-click a text to edit it") | ✅ |
| M20 | Editor visual | O arrastar usa as mesmas funções e regras da barra (M16: uma transação, só se o `parse` aceita, a mensagem se não der); nada no modo leitura nem nos outros tipos de diagrama | ✅ |
| M21 | Editor visual | **29 modelos no menu "/"**, em cinco grupos do menu: Fluxos (fluxograma, sequência, estados, jornada do usuário, raias, modelagem de eventos), Estrutura (classes, entidades, arquitetura, blocos, C4, pacote, requisitos, árvore de arquivos), Planejamento (Gantt, linha do tempo, Kanban, Git), Gráficos (pizza, XY, quadrante, radar, Sankey, treemap) e Ideias (mapa mental, Ishikawa, Venn, Wardley, Cynefin). Nome "Diagrama: …" (o filtro "/diagrama" acha todos) e exemplo no idioma da pessoa | ✅ |
| M22 | Editor visual | **Galeria:** o botão de diagrama da barra abre uma janela com a miniatura de cada modelo, filtro por grupo e busca pelo nome (sem acento); clicar ou Enter insere o exemplo, setas andam entre os cartões, Esc fecha sem mudar nada | ✅ |
| M23 | Editor visual | **Tipos novos do Mermaid** (treemap 11.10, Ishikawa e Venn 11.13, árvore e Wardley 11.14, modelagem de eventos 11.15, raias e Cynefin 11.16; Use Case e Agentflow do 12): etiqueta "Backstage 11.x+" no menu e na galeria, e aviso embaixo do desenho com a versão que o TechDocs precisa | ✅ |
| M24 | Editor visual | **Cores como no mermaid.js.org:** temas `redux-color` (claro) e `redux-dark-color` (escuro) no lugar de `default`/`dark`. No site publicado as cores continuam as do MkDocs Material ou do addon do Backstage | ✅ |
| M25 | Site | **Site nas mesmas cores do editor:** o primeiro diagrama (e o ajuste do Conferir) põe no `extra_javascript` do `mkdocs.yml` o mesmo Mermaid do editor (unpkg, versão fixa) e `javascripts/techdocs-mermaid.js`, criado no `docs_dir`: ele troca as cores do MkDocs Material pelos temas `redux-color`/`redux-dark-color` (claro ou escuro como a página) e usa a fonte da página. O Conferir aponta o que falta (`mermaid-colors-missing`, `mermaid-colors-script-missing`). No Backstage os scripts do site não rodam: o README mostra o `app-config.yaml` do addon com os mesmos temas | ✅ |
| M26 | Editor visual | Diagramas com a fonte do editor; rótulos sem o espaçamento dos parágrafos do editor (cortava o texto embaixo); miniaturas da galeria numa fila e num cache à parte (uma por vez, sem atrasar nem tirar do cache os diagramas da página); Tab preso na galeria | ✅ |
| M27 | Editor visual e site | **Diagramas grandes:** um desenho largo não encolhe abaixo de 60% do tamanho natural (o texto continua legível) e o bloco rola para o lado, a partir do começo, no editor e no site (pelo script das cores). Acima dos limites do Mermaid (mais de 500 ligações ou 50 mil caracteres), a mensagem "Diagrama grande demais…" no lugar do desenho, e o Conferir aponta a página (`mermaid-too-big`), porque o site também não desenha | ✅ |
| M28 | Editor visual | **Ampliar:** botão na linha do Copiar/Editar do bloco (sempre à vista num desenho com mais de 900 px de largura ou 600 de altura; nos outros, ao passar o mouse) abre o desenho numa janela por cima da página: zoom pela roda do mouse no ponteiro, arrastar para mover, −/+, **Ajustar** (um desenho muito largo ajusta pela altura, a partir da esquerda, para continuar legível) e **100%**; teclado +, −, 0, 1, setas, Tab dentro da janela, Esc fecha e devolve o foco ao botão. Só olha: o texto não muda. Protótipo aprovado | ✅ |
| M29 | Site | **Ampliar no site e troca de claro/escuro:** o script das cores põe o botão Ampliar em cada diagrama (dentro do shadow root fechado do Material, que chega pelo `fn` do `render`) e abre a mesma janela de zoom do editor, nas cores do Material e na língua da página (pt ou inglês). Trocar entre claro e escuro pelo botão do site redesenha os diagramas com o tema certo (antes ficavam com as cores do modo em que a página abriu) | ✅ |

### M10 e M11: decisões (2026-11-20)

- **Por quê:** primeiro passo para montar diagramas com o mouse. Ordem combinada, cada passo numa versão própria
  que entrega valor sozinho: (1) M9–M11, na 0.11.0; (2) funções no `core` que mudam um fluxograma pelo código
  (acrescentar, ligar, renomear, apagar nó) sem estragar o resto; (3) arrastar e soltar em cima delas, com o layout
  automático (o Mermaid não guarda posição: arrastar cria e liga, não posiciona).
- **Clique duplo, não simples:** o clique simples continua selecionando o bloco; um clique que muda a tela sem
  querer assusta mais quem não é técnico do que um gesto a descobrir pela dica.
- **Como abre o código (forma A, escolhida):** usar o bloco do Crepe como está. O clique duplo aperta o
  `preview-toggle-button` e, no quadro seguinte, põe uma seleção do ProseMirror no trecho; o `setSelection` do node
  view do Crepe passa a seleção ao CodeMirror. Descartadas: copiar o componente do bloco para `vendor/` (manter ~800
  linhas do Milkdown à mão) e um bloco Mermaid próprio (refazer editor, prévia, leitura e ida e volta; reavaliar no
  passo 3 se precisar). Se o Milkdown mudar a classe do botão, o clique duplo deixa de abrir o código, sem quebrar
  nada, e o teste do editor pega.
- **Mapa do desenho para o código** num módulo próprio (`diagramSource.ts`, sem DOM do editor), testado por
  unitários: é a peça que o passo 3 reaproveita.


### M21 a M24: decisões (2026-11-23)

- **Quais tipos:** os que o Mermaid 11 desenha. Os 21 que existem desde a 11.6 (o mínimo do addon do Backstage) entram
  sem aviso; os 8 que pedem uma 11 mais nova entram com a etiqueta e o aviso (M23). Use Case e Agentflow (só no 12)
  e ZenUML (plugin à parte) ficam fora: quebrariam no site publicado.
- **Menu e galeria:** o menu "/" para quem digita, a galeria (com o desenho de cada modelo) pelo botão da barra.
- **Aviso nos dois lugares:** etiqueta no menu e na galeria, faixa embaixo do desenho. Com o M25 o site do MkDocs usa
  o mesmo Mermaid do editor; o aviso fala só do addon do Backstage.
- **Site colorido como o editor (M25), e não o contrário:** decisão do usuário. Conferido num site MkDocs Material
  9.8.2 de verdade, no claro e no escuro.
- **Protótipo aprovado:** https://claude.ai/artifact/1eSwZB8e9DdMB4DEpNus34
- **Exemplos do site como teste:** os 617 exemplos do mermaid.js.org (introdução e sintaxe de cada tipo) ficam em
  `packages/ui/e2e/fixtures/mermaid-site-examples.json` e abrem no editor visual a cada release
  (`mermaid-site-examples.spec.ts`; `npm run sync-mermaid-examples` baixa de novo ao atualizar o Mermaid).

### M17 a M20: decisões (2026-11-23)

- **Por quê:** passo 3 do caminho até montar fluxogramas com o mouse, na 0.13.0. Usa as funções do passo 2
  (`flowchartEdit.ts`) e o mesmo caminho da barra (validar, uma transação, abrir o código no nome novo).
- **Arrastar cria e liga, não posiciona:** o Mermaid não guarda posição; o layout automático decide onde o nó
  novo aparece.
- **Soltar no vazio cria um passo, não uma decisão:** o passo é o caso mais comum; a decisão continua na barra.
- **Sem arrastar de uma paleta:** o primeiro nó já vem no exemplo do fluxograma; criar a partir de um nó existente
  cobre o resto.

### M12 a M16: decisões (2026-11-20)

- **Por quê:** passo 2 do caminho até montar fluxogramas com o mouse (ver M10 e M11). Funções que mudam o
  fluxograma pelo código sozinhas não entregam nada a quem usa; junto com a barra do nó entregam, e o arrastar e
  soltar do passo 3 usa as mesmas funções. Vai na 0.12.0.
- **Botões no nó, não arrastar (escolha do usuário):** fácil de descobrir, sem precisar acertar o arrasto no SVG, e
  o mesmo "clicar e escolher" do menu `/`. Arrastar fica para depois.
- **Abrir o código depois de criar um nó:** quem cria um passo quer dar nome a ele; com o texto selecionado é só
  digitar. O desenho continua embaixo do código e a barra funciona nele, então dá para criar vários seguidos. Sem
  isso ficariam caixas "Novo passo" esquecidas no site. Ligar e Apagar não abrem: não há o que digitar.
- **Sim/Não nas setas da decisão:** um losango com duas setas sem rótulo não diz qual caminho é qual. Trocar o
  rótulo é o clique duplo do M10.
- **Linhas novas no fim, não ao lado do nó:** mexe o mínimo no que a pessoa escreveu e não precisa entender a
  ordem do código; o layout do Mermaid não depende da ordem das linhas.
- **Como o código muda (minha escolha, entre três):**
  - **A, escolhida:** edição do texto por linha num módulo puro (`flowchartEdit.ts`, ao lado do `diagramSource.ts`
    no `packages/ui`, sem DOM), com testes unitários. Preserva comentários, recuo, ordem e estilos; o M16 cobre o
    que ela não entende.
  - B, descartada: ler com o parser do Mermaid e gerar o código de novo. Perde comentários, recuo e a ordem que a
    pessoa escolheu, e o diff no Git vira o arquivo inteiro.
  - C, descartada: um parser próprio completo do fluxograma. Grande demais para o ganho; a A com o M16 cobre os
    casos comuns sem risco.
- **Fica para o construtor:** o visual da barra (seguir os botões do Crepe e as cores do tema), a posição exata
  (acima do nó, sem sair do bloco) e o formato do cursor no modo Ligar.

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
- M10: unitários do `diagramSource.ts` (nó com e sem rótulo, formas `[]` `{}` `()`, id repetido em setas, rótulo de
  seta, sequência, estados, Gantt, entidades, texto não achado); editor no navegador: clique duplo abre o código com
  o trecho selecionado e, com o código aberto, leva a outra linha.
- M11: editor no navegador, os cinco itens no `/` inserem o exemplo; unitário, os cinco exemplos passam no `parse`
  do Mermaid nas duas línguas. M9: `test:bundle` com o orçamento novo.
- M12–M16: unitários do `flowchartEdit.ts` (acrescentar passo e decisão com id livre e recuo; Sim/Não/sem rótulo
  pela contagem; ligar sem duplicar; apagar nó sozinho, no começo, no meio e no fim de uma cadeia, com rótulo na
  seta, com `style`/`class`/`click`; id com hífen; front matter; comentários preservados); editor no navegador:
  barra aparece no clique num nó de fluxograma e não em sequência nem no modo leitura, + Passo depois abre o código
  com "Novo passo" selecionado, Ligar a… e Apagar mudam o Markdown salvo, Ctrl+Z desfaz cada ação de uma vez, `A &
  B --> C` mostra a mensagem do M16 sem mudar nada.
