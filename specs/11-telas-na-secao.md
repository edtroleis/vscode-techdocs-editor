# 11 — Telas na seção TechDocs

## Por quê

A 0.21 trocou as listas de opções no topo da tela pela janela Configurações, na própria seção TechDocs, e as pessoas
gostaram (opções uma embaixo da outra, com rádio, cada escolha visível de uma vez). Mas os fluxos de várias
escolhas em sequência continuam como perguntas no topo (QuickPick e caixa de texto), uma de cada vez: quem está na
terceira pergunta não vê mais as duas primeiras, um Esc no meio perde tudo, e não dá para voltar uma etapa.

Também sobrou código das listas antigas que nenhum botão chama mais, mantido vivo só pelos testes.

## Objetivo

Os fluxos com várias escolhas viram uma tela na seção TechDocs, com tudo visível e editável até o fim e um botão
para concluir. Os de uma escolha só (renomear, trocar de site) continuam no topo, que é o jeito do VS Code para isso.

## Fora do escopo (não fazer)

- Renomear, duplicar e mover da árvore; Trocar diretório ou repo; Filtrar sites; o endereço em Abrir documentação
  do GitHub: uma pergunta só, ficam no topo.
- A identidade do Git e os arquivos fora da documentação, no Enviar: perguntas raras, ficam.
- A página nova em branco (Nova página, sem template): não pergunta nada, continua assim.

## Anti-objetivos (falha mesmo que funcione)

- Mais cliques que hoje para o caso comum (template, título, Enter).
- Uma tela que esconde o editor da página: a tela fica na seção TechDocs, a página abre no editor ao concluir.
- Perder o que foi digitado ao trocar de template ou ao clicar fora.

## Decisões do usuário (2026-11-25)

- Escrever a spec das telas na seção, começando pela página nova a partir de template.
- O código das listas antigas que só os testes chamam sai (faxina, junto ou antes).
- Estilo da janela Configurações da 0.21: opções uma embaixo da outra, com rádio (não cartões).
- Protótipo (prints) antes de implementar cada tela.
- Ordem: faxina e correções na 0.22.1; **Verificação primeiro (0.23)**, depois a Nova página (0.24); os links que
  não quebram (spec 10) na 0.25; o Open VSX (spec 03) na 0.26.

## Fases

### Fase 0 — Faxina e correções (0.22.1)

- Sai `CatalogOptions.choose` (com `pickMode` e `pickScope`) e `TemplateOptions.choose` (com `pickAction`,
  `askRepository`, `pickScope`): desde a 0.21 todo botão e comando abre a janela Configurações; só os testes de
  integração chamavam. Saem os testes dessas listas; o que eles provavam (gravar para o time, só para mim, voltar ao
  padrão) já está no teste da janela Configurações, e o que faltar lá entra lá.
- O botão de engrenagem da lista de templates passa a abrir a janela Configurações (hoje abre o comando antigo, que
  já redireciona).
- Correções vistas na 0.22, na mesma versão:
  - teste do "Excluir" de um anexo sem uso pela Verificação, um item por vez (a pergunta e o Desfazer);
  - teste da pergunta "Excluir ou Manter" ao salvar pelo editor visual (o de hoje edita pelo editor de texto);
  - uma palavra só em pt-BR para remover arquivo ("Excluir" ou "Apagar") em toda a extensão;
  - `vitest.config.ts` em ESM carregado como CommonJS (o aviso em todo teste; renomear para `.mts`);
  - o `ECONNRESET` no fim dos testes do navegador;
  - R5 (spec 00): um cenário visual que prova o Ctrl+Z com o foco dentro do editor visual (desfaz uma vez, no
    editor, e não duas).

### Fase 1 — Página nova a partir de template

Uma janela **Nova página** na seção TechDocs, como a Configurações (abre no lugar das seções, com o X para fechar).
Abre por **Nova página a partir de template…** (árvore, menu de contexto de uma seção, paleta, botão TechDocs do
editor). De cima para baixo:

1. **Site** (só com mais de um site): lista de escolha; já vem com o site mostrado na árvore.
2. **Tipo de página**: os templates como rádios, um embaixo do outro, nome e a descrição embaixo, com **Ver
   exemplo** ao lado de cada um (abre ao lado, como hoje); os da empresa e os da extensão em grupos, com o nome do
   repositório; a engrenagem leva à janela Configurações › Templates.
3. **Título**: caixa de texto, com o foco ao abrir a tela.
4. **Arquivo**: preenchido a partir do título enquanto a pessoa não mexer nele (`guides/roll-back.md`; numerado
   quando o template pede); editável; o erro aparece embaixo na hora ("já existe", "fora do diretório das docs").
5. **Campos do template** (dono e os do template): caixas de texto com os valores padrão; trocar de template mantém
   os campos com o mesmo nome.
6. **Menu do site**: a seção do menu onde a página entra (lista com as seções do `nav`; vem com a seção clicada na
   árvore), ou **Fora do menu**. Sem `nav` no `mkdocs.yml` (menu pelas pastas), a linha não aparece.
7. **Criar** (Enter em qualquer campo) e **Cancelar**.

Ao criar: a página abre no editor visual com o primeiro trecho a preencher selecionado (como hoje, TP7) e a janela
fecha. As regras de hoje continuam (TP4: nunca sobrescreve, nunca sai do `docs_dir`).

### Fase 2 — Criar o repositório no Enviar

Hoje: dono (lista), nome (caixa), visibilidade (lista). Vira uma tela na seção: dono, nome (com o erro "já existe"
na hora), privado/interno/público com rádio e a explicação de cada um, **Criar e enviar**.

### Fase 3 — Janela Verificação (protótipo aprovado em 2026-11-25)

No lugar da árvore por tipo de achado e da notificação do botão Conferir, uma janela na seção TechDocs, na mesma
posição:

- **Topo:** a lista de sites (cada um com ✕/⚠/✓) e **↻ Conferir**.
- **Resumo**, preso no topo enquanto a lista rola: "Ainda não dá para publicar" (quantos impedem de montar, quantos
  aparecem errado, quantas sugestões, quantos têm ajuste automático), **Corrigir os N automáticos**, **Ver no painel
  Problemas** e quando foi conferido. Sem problemas: "✓ Pronto para publicar", com **Enviar (N)**.
- **Três grupos pelo efeito no site**, nesta ordem: **O site não monta** (erros), **Aparece errado no site**
  (avisos), **Sugestões** (dicas, que não contam como problema). Os grupos recolhem; Sugestões começa recolhido
  quando há problemas.
- **Cada item:** título, arquivo e linha, a explicação em linguagem simples sempre visível e as ações como botões na
  linha (Corrigir, Ver diff, Abrir na linha, Criar a página, Tirar do menu, Pôr no menu…).
- **Muitos itens:** os do mesmo tipo viram um ("Formatação em 12 páginas", com ▸ para a lista); grupo com mais de 10
  mostra 10 e "mostrar os outros N"; a janela rola.
- **Corrigir os automáticos:** o resultado fica na janela (o que mudou, em quais arquivos), com **Desfazer** e **Ver o
  que mudou**; substitui a notificação do Conferir e a pergunta Aplicar / Pular / Parar no topo para cada correção.
- O painel Problemas continua recebendo os mesmos itens.

### Fase 4 — Site novo

O painel de prévia do site novo já é uma tela; as perguntas que sobraram no topo (aproveitar as páginas que já
existem, usar o README, o nome e os campos do template) entram no painel.

## Itens

| Item | Fase | O que entrega | Situação |
|------|------|---------------|----------|
| TS0 | 0 | Faxina: sem as listas antigas de catálogo e templates; testes ajustados | ⬜ |
| TS1 | 1 | Protótipo da janela Nova página (prints, tema escuro e claro, português), aprovado antes do código | ⬜ |
| TS2 | 1 | A janela Nova página: estado e escolhas no host, o webview só desenha (como Configurações e Enviar) | ⬜ |
| TS3 | 1 | Todos os pontos de entrada abrem a janela; as respostas prontas dos testes (`NewPageAnswers`) continuam valendo sem a tela | ⬜ |
| TS4 | 2 | Protótipo e tela de criar o repositório | ⬜ |
| TS5 | 3 | Janela Verificação (protótipo aprovado): resumo preso no topo, três grupos, ações na linha, Corrigir os automáticos com Desfazer na janela, muitos itens agrupados | ⬜ |
| TS6 | 4 | As perguntas do site novo no painel de prévia | ⬜ |
| TS7 | — | Acessibilidade de cada tela (teclado, leitor de tela, contraste nos dois temas) | ⬜ |
| TS8 | — | README, README.pt-BR, CHANGELOG e GIFs; cenários visuais ajustados a cada fase | ⬜ |

## Decisões de quem escreveu a spec (o usuário pode mudar)

- **Uma fase por versão**, cada uma com protótipo antes.
- **A janela Nova página fica aberta só até criar ou cancelar**; abrir de novo começa do zero, com o último tipo de
  página escolhido já marcado.
- **O arquivo segue o título** até a pessoa editar o campo do arquivo; depois disso, não muda mais sozinho.
- **Cancelar não pergunta nada**: nada foi gravado.

## Restrições

- O mesmo modelo da Configurações e do Enviar: o host guarda o estado e grava, o webview só desenha e devolve as
  escolhas; os textos em inglês no código e em pt-BR no bundle; funciona no vscode.dev.
- Os testes de integração continuam sem tela (respostas prontas); a tela tem os testes de webview dela.

## Testes

- Webview: cada campo, a ordem, o erro do arquivo na hora, trocar de template sem perder o que foi digitado, Enter
  para criar, teclado do começo ao fim.
- Integração: criar pela janela com as respostas da tela (template, título, arquivo, campos, seção do menu) e conferir
  o arquivo, o `nav` e a página aberta no editor visual.
- Cenários visuais que criam páginas a partir de template (os que usam a lista no topo hoje) passam a usar a janela.

## Deixado para quem constrói

- Se a janela Nova página divide código com a Configurações (o esqueleto do webview, o estilo) ou é um arquivo à
  parte.
- Como mostrar muitos templates (dezenas, no repositório da empresa): busca no topo da lista ou grupos recolhíveis.
