# 09 — Clonar e Enviar (0.19.0)

Protótipo de referência: `C:\Users\Public\techdocs-prototipo-enviar\index.html` (telas A, B, 1–16).
Esta spec substitui, na spec 02, o **modo remoto** (M1–M9), o **painel de publicação por página** (LC5 e a
seção "Publicação") e muda B1. O que não estiver aqui continua como na spec 02.

## Por quê

Escrever no TechDocs exige Git: branch, commit, push e PR. Isso afasta quem mais tem o que documentar e não é
dev. A extensão já esconde o Markdown do MkDocs; falta esconder o Git. Hoje ela publica **página por página**
(cada página vira uma branch `docs/<login>/<arquivo>` e um PR) e tem um modo que edita pela API do GitHub sem
clonar. Os dois somem. Fica um modelo só, que é o modelo mental do usuário:

1. A doc está **sempre num diretório do computador**: clonada do GitHub ou criada ali.
2. **Ctrl+S só grava o arquivo**. Nada vai ao GitHub.
3. **Enviar (N)** manda **tudo o que mudou no repositório** num envio só (um PR), quando a pessoa quiser.

## Objetivos

- Clonar uma doc do GitHub em dois cliques (telas A e B), sem saber o que é `git clone`.
- Um botão **Enviar (N)** com o número de mudanças, na barra do editor e na árvore (tela 1).
- Tela de envio: o que vai, com **Desfazer** por item, conferência antes, sites agrupados (telas 2, 6, 15).
- Acompanhar o envio em linguagem simples até ser **aprovado e entrar na branch principal** (telas 4, 9, 10, 14).
- Criar o repositório no GitHub quando o diretório ainda não está ligado a um.
- Opção de mandar **direto na branch principal**, sem PR, por configuração.

## Fora do escopo (não fazer)

- **Nada do Backstage**: a extensão para quando o envio entra na branch principal. Sai a tela 16
  ("Publicando no Backstage…") e o "Ver no Backstage". Não acompanhar pipeline da branch principal.
- Fork e "Pedir acesso" (sem permissão: só "Copiar link do repositório", tela 5).
- R2 do protótipo (telas 7, 11, 12): trazer o que outros publicaram com aviso na árvore, "Ver as duas versões"
  no visual, desmarcar itens. R3 (telas 3, 8, sem internet completo): diff visual, comentários do revisor no
  painel.
- Registrar a doc no catálogo do Backstage.
- VS Code no navegador (vscode.dev): sem disco e sem Git, a extensão não oferece clonar nem enviar ali.

## Anti-objetivos (falha mesmo que funcione)

- Aparecer **branch, commit, push, PR, merge, rebase** em qualquer texto para quem escreve. Os termos são
  "envio", "pedido de revisão", "branch principal" só na configuração.
- Perder texto: desistir, desfazer, falha de rede ou conflito **nunca** apagam alteração sem confirmação.
- Levar no envio arquivo que não é da documentação (código do repositório, `package.json`, `README.md` de fora).
- Mexer no que o dev faz com Git por fora: o envio respeita a branch e os commits que já existem.

## Decisões do usuário

| # | Decisão |
|---|---------|
| U1 | Envio pelo repositório inteiro: um envio = um PR com todas as mudanças, agrupadas por site (tela 15) |
| U2 | Ctrl+S só grava no disco |
| U3 | O modo "editar direto no GitHub, sem clonar" **sai** da extensão, com os botões por página |
| U4 | O Enviar oferece **criar o repositório no GitHub** quando o diretório não está ligado a um |
| U5 | Não acompanhar o Backstage; o fim é "entrou na branch principal" |
| U6 | Padrão: PR acompanhado até a aprovação (telas 4, 9, 10, 14). Configuração para mandar direto na branch principal |
| U7 | Construir com o Git do VS Code (extensão `vscode.git`) + API do GitHub (abordagem A abaixo) |
| U8 | Sem permissão de escrita: só "Copiar link"; sem fork (decisão do protótipo) |
| U9 | **Sem transição** do jeito antigo: só o usuário usava. O código sai inteiro; as branches de teste ele limpa no GitHub |

## Abordagens consideradas

| | Abordagem | Troca | Escolha |
|---|---|---|---|
| A | **Git do VS Code** (`vscode.git` API 1) para clonar, branch, commit, push; `GitHubClient` do `core` para PR, checks, permissões e criar o repositório | Reaproveita `VscodeGit`/`LocalPublisher`; mesmo login do VS Code; o Controle do código-fonte continua coerente para devs. Exige Git instalado | **Escolhida** |
| B | Tudo pela API do GitHub (baixar o pacote, montar commits pela API) | Funciona sem Git, mas o diretório não fica ligado ao repositório: dev não usa Git nele | Descartada: contraria U2/"linkado a um repo remoto" |
| C | Manter os dois jeitos (por página e repositório inteiro) | Dois fluxos para manter; a mesma página poderia estar em dois PRs | Descartada pelo usuário |

## Como funciona

### Clonar (telas A e B)

- **"Abrir documentação do GitHub…"** (botão da tela da árvore sem docs e comando): lista os repositórios da conta
  com `mkdocs.yml` (o que `remoteRepos.ts`/`findRemoteSites` já fazem, reaproveitar) e "Colar o link de outro
  repositório…". Escolher vai direto à tela B (não pergunta "como editar": só existe clonar).
- **Tela B**: diretório sugerido `<techdocsEditor.clone.directory>/<repo>` (padrão `~/Documents/TechDocs`),
  "Clonar aqui" ou "Escolher outro diretório…", andamento com %, e no fim "Abrir" (troca a janela) ou "Abrir em
  nova janela". Repositório já clonado (um clone conhecido com o mesmo `origin`): oferece abrir a cópia.
- Sem Git instalado: aviso com o link de instalação do Git (não há mais alternativa sem Git).
- O link do Backstage (B1, `vscode://edtroleis.techdocs-editor/open?host&repo&path`) cai na tela B; depois de
  clonar ou com a cópia que já existe, abre **aquela página**. B3 (validação dos parâmetros) continua.

### Mudanças não enviadas (tela 1)

- **Uma mudança** = arquivo diferente da branch principal do `origin` entre os **arquivos da documentação**:
  tudo dentro do `docs_dir` de cada site, o `mkdocs.yml` e os arquivos do site criados pela extensão
  (`catalog-info.yaml`, `.markdownlint.yaml`, `.techdocs-editor.yaml`) ao lado do `mkdocs.yml`.
- Contam: alterada, nova, removida, movida/renomeada (par removida+nova detectado pelo Git ou pela árvore), imagens
  (agrupadas: "2 imagens novas usadas em X") e o menu do site (`nav` do `mkdocs.yml`) como item próprio.
- Árvore: bolinha laranja (alterada), verde (nova). **Enviar (N)** no título da árvore, na barra do editor e na
  barra de status. N = número de itens da tela 6.
- Arquivos alterados fora da documentação não contam; a tela de envio avisa "N arquivos fora da documentação não
  vão neste envio" com "Ver quais".

### Tela de envio (telas 2, 6, 15)

- Um `WebviewPanel` "Enviar para o repositório". Título "Enviar N mudanças para <site>" (ou "de K sites"),
  itens agrupados por site com tipo (ALTERADA, NOVA, MOVIDA, REMOVIDA, IMAGENS, MENU), caminho e ações.
- **Ver o que mudou**: abre o diff de texto do VS Code (branch principal ↔ disco). O diff visual (tela 3) é R3.
- **Desfazer** por item, com confirmação dizendo o que acontece: volta aquele item ao que está na branch
  principal (página nova é apagada; removida volta; movida volta ao lugar; o menu volta).
- **"O que mudou"**: resumo gerado ("Atualiza X e Y; cria Z"), editável; vira título/descrição do PR.
- **Conferência** roda sozinha ao abrir: lint (com "Corrigir" para o que tem correção automática), links,
  imagens e menu, pelo que `repoCheck`/`checkSite`/lint já fazem. Só o que sobra sem correção trava o botão,
  com "Ver na página".
- Botão **Enviar para revisão** (ou **Publicar** quando o repositório não pede revisão ou com `send.target: main`).

### O envio (Git e GitHub)

Padrão (`techdocsEditor.send.target: "pullRequest"`):

1. Login no GitHub se faltar (tela 5, "Entre no GitHub para enviar").
2. Sem permissão de escrita (`permissions.push: false`): tela 5, "Você não pode enviar…", com "Copiar link".
3. Sem `user.name`/`user.email` no Git: tela 13, preenchida pela conta do GitHub (nome; e-mail principal e o
   `noreply`), gravada no Git **global**, uma vez.
4. A branch principal do `origin` andou: traz antes (fetch + merge na branch do envio). Sem sobreposição, junta
   sozinho. Com sobreposição: abre o editor de merge do VS Code com uma mensagem simples (LC4); a tela 11 é R2.
5. Cria a branch do envio a partir da branch principal (`techdocsEditor.branchPattern`, padrão
   `docs/{login}/{date}`, `{date}` = `aaaammdd-hhmm`), faz commit **só dos arquivos da documentação**, push, e abre
   o PR (pronto, não draft) com o "O que mudou".
6. A árvore marca as páginas "em revisão"; o editor mostra "Em revisão".

Durante a revisão:

- Continuar editando: as próximas mudanças entram **no mesmo envio** ("1 página com mudança nova: Enviar de
  novo", que faz commit + push na mesma branch).
- Painel **Envio** (`WebviewView`, tela 4): "Enviado · ver no GitHub", verificações do PR em linguagem simples
  (P2–P5 e P8–P9 da spec 02 continuam), "Esperando revisão (N aprovação de quem cuida do repositório)",
  "Pediram mudanças · ver no GitHub" (comentários no painel são R3), "Continuar editando", "Desistir do envio".
- Verificação falhou (tela 10): problemas por página com "Ver na linha" e "Corrigir" quando há correção
  automática; depois, "Enviar de novo".
- **Desistir** (tela 14): confirmação; fecha o PR, apaga a branch no GitHub e local, e as alterações voltam
  **não enviadas** na branch principal local (bolinhas de volta). Já aprovado/mesclado: não dá para desistir.

Fim (tela 9, sem o Backstage): PR mesclado → "Aprovado e na branch principal" (quem aprovou), a cópia volta
sozinha para a branch principal atualizada (checkout + pull) e a branch do envio é apagada. Uma mudança nova
depois disso é outro envio.

Com `techdocsEditor.send.target: "main"`: os passos 1–4, depois commit na branch principal e push. Sem PR, sem
painel de revisão; o botão é **Publicar**. Se a proteção da branch recusar o push: mensagem dizendo que o
repositório exige revisão, com "Enviar para revisão" (o fluxo padrão).

Repositório sem revisão obrigatória (0 aprovações no ruleset/branch protection): o botão é **Publicar**, mas o
fluxo continua por PR (tela 9, parte do meio), e o painel some a etapa "Esperando revisão". **Sem merge pela
extensão** (X7 da spec 02 continua).

Sem internet (tela 9): "Suas alterações estão salvas no computador" com "Enviar quando voltar" (tenta de novo
ao voltar a conexão) e "Cancelar".

### Criar o repositório (U4)

O diretório não tem Git, ou tem Git sem `origin`: o Enviar mostra "Este diretório ainda não está no GitHub" com
dono (a conta ou uma organização onde a pessoa pode criar repositórios), nome sugerido pelo diretório e
**privado** marcado. Cria pela API, faz `git init` se faltar, liga o `origin`, e o **primeiro envio vai direto na
branch principal** (não há o que revisar). Os próximos seguem `send.target`.

### Vários sites no mesmo repositório (tela 15)

Um envio por repositório com todos os sites dele, agrupado por site. Desmarcar um site inteiro fica para a R2
(junto com a tela 12). Workspace com vários repositórios: um Enviar por repositório (a árvore mostra o do site
selecionado).

## O que sai

- Modo remoto inteiro: `remote/` (`openRemote`, `remoteFs` e o esquema `techdocs:`, `conflictPanel` do salvar
  remoto, `remoteRepos` só fica no que a lista da tela A reaproveita), `publish/remoteGit.ts`, e no `core` o que
  só ele usa (`remoteSession`, `remoteDraft`, `remoteTree`, `remoteLink` — exceto o parse do link de B1).
- Painel de publicação por página: `publishPanel.ts`, `strip.ts`, a faixa de estado da página (Salvar rascunho,
  Salvar e verificar, Enviar, Descartar); `localPublisher.ts` vira a base do envio do repositório inteiro.
- Configurações: `techdocsEditor.mode`, `techdocsEditor.local.publishPanel`, `techdocsEditor.drafts.skipCi`;
  `branchPattern` perde o `{path}` (ganha `{date}`). Configuração antiga com `{path}`: ignorada com aviso no canal.
- "Histórico da página" e "Minhas alterações" (`mineView`), que dependem do modo remoto: saem (o histórico é do
  GitHub ou do Git do VS Code).

## Configurações novas

```jsonc
{
  "techdocsEditor.send.target": "pullRequest",           // pullRequest | main
  "techdocsEditor.clone.directory": "~/Documents/TechDocs",
  "techdocsEditor.branchPattern": "docs/{login}/{date}"
}
```

Na 0.20.0 elas entram no menu ⋯ da seção TechDocs (junto com as de anexos).

## Restrições

- Textos em pt-BR e en (l10n), "diretório" e não "pasta".
- Token nunca no webview (A-6 da spec 02).
- Testes: o teste de cada mudança; os cenários de usuário (`npm run test:scenarios`, repos
  `techdocs-cenario-*`) cobrem clonar, enviar, desistir e criar repo; `test:all` só na release.
- Versão de teste (`.vsix` 0.18.99) instalada e aprovada pelo usuário antes da tag.

## Decisões de quem escreveu a spec (o usuário pode mudar)

| # | Decisão |
|---|---------|
| C1 | **Branch de dev**: na branch principal, o envio cria `docs/{login}/{date}`. Numa outra branch que não é de envio, o envio usa a **branch atual** (o PR sai dela). N = arquivos da documentação diferentes entre o `origin/<principal>` e o HEAD + a árvore de trabalho: commits de docs ainda não enviados contam. Desfazer de um item já commitado volta o arquivo ao da principal como alteração nova |
| C2 | **Um envio aberto por repositório por pessoa.** O estado vem da branch atual (é uma branch de envio, ou tem PR aberto do login) e do PR aberto dela, nunca de estado salvo à parte. Trocar de branch troca o que o painel mostra |
| C3 | **N** compara com o `origin/<principal>` do último fetch. Fetch ao abrir a tela de envio, ao enviar e no polling do painel Envio (P8/P9); sem fetch periódico fora disso |
| C4 | **Repositório novo**: a raiz é a do Git que já existe; sem Git, o diretório do workspace que contém o `mkdocs.yml`. O primeiro envio leva **só os arquivos da documentação** (como qualquer envio); o resto aparece em "fora da documentação" |
| C5 | **Desistir com a principal andada**: volta à branch principal **local** (sem atualizar) e reaplica as mudanças do envio como não commitadas. Se a reaplicação conflitar, a branch do envio fica guardada localmente e abre o editor de merge; nada é apagado antes de reaplicar |
| C6 | Onde o protótipo cita o Backstage (tela 16, "Publicado no Backstage", "Ver no Backstage"), esta spec vence |

## Deixado para quem constrói

- Como reaproveitar `LocalPublisher`/`VscodeGit` (ampliar `LocalGit` com fetch/merge/clone/init/addRemote) ou
  reescrever em cima deles.
- Se o clone usa a API do `vscode.git` (`clone`) ou o comando `git.clone`; como detectar "já clonado".
- Detecção de movida/renomeada e do agrupamento de imagens por página.
- O texto gerado do "O que mudou".
