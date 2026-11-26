# 10 — Links que não quebram

## Por quê

O endereço de uma página no TechDocs é o caminho do arquivo dentro do `docs_dir`
(`/docs/default/component/payments/guides/deploy/`). Quem renomeia ou move uma página pela extensão tem o `nav` e os
links entre as páginas acertados (spec 04, árvore e Explorer), mas o endereço muda. O link que já foi divulgado por
fora (Slack, e-mail, Jira, outro site) quebra, e o time precisa divulgar de novo. É o motivo mais comum para alguém
ter medo de reorganizar a documentação.

## Objetivo

O link de uma página publicada continua abrindo depois que ela é renomeada, movida ou apagada, sem a pessoa precisar
lembrar de nada: a extensão mantém os endereços antigos funcionando, com o que o TechDocs já roda.

## O que foi conferido (2026-11-25, Backstage local)

- O `mkdocs-techdocs-core` 1.7.1 traz o `mkdocs-redirects` 1.2.3 como dependência, mas não o liga: o `mkdocs.yml`
  precisa ter `- redirects` em `plugins`, com o `redirect_maps` (`antiga.md: nova.md`, caminhos relativos ao
  `docs_dir`). No build, o plugin grava no endereço antigo uma página HTML com `<meta http-equiv="refresh">`.
- O `@backstage/plugin-techdocs` 1.19 (Backstage 1.56) trata essa página (`handleMetaRedirects`): mostra o aviso
  "This TechDocs page is no longer maintained. Will automatically redirect to the designated replacement." com o
  botão "Redirect now" e, 3 segundos depois, abre a página nova. O texto e a espera são do Backstage: a extensão não
  muda.
- Não conferido: o `techdocs-core` da pipeline ou imagem que monta o site de cada empresa. É o item LP1.

## Objetivos

- Renomear ou mover uma página publicada mantém o endereço antigo funcionando, sozinho, com um aviso.
- Apagar uma página publicada pergunta para onde o endereço antigo leva.
- A Verificação mantém os redirecionamentos corretos (sem destino que não existe, sem cadeia, com o plugin ligado).
- Tudo dentro do `mkdocs.yml` do site: nada além do que o Backstage roda (sem script, sem página extra feita à mão).

## Fora do escopo (não fazer)

- Âncoras (`#seção`) que mudam quando o título muda: fica para uma segunda parte (âncora fixa com `{#id}`, que o
  `attr_list` do techdocs-core já aceita).
- Renomear o componente (`metadata.name` do `catalog-info.yaml`), que muda o endereço do site inteiro.
- Links para arquivos de código no GitHub (`blob/main/...`).
- Mudar o aviso ou a espera de 3 segundos do Backstage.

## Anti-objetivos (falha mesmo que funcione)

- Um redirecionamento que leva para uma página que não existe (pior que o 404: o leitor espera 3 segundos para
  nada).
- Redirecionamentos em cadeia (A → B → C): cada salto é mais um aviso de 3 segundos.
- `mkdocs build --strict` falhando por causa de um redirecionamento.
- Redirecionamento de página que ninguém viu (criada e renomeada antes de enviar): lixo no `mkdocs.yml`.

## Decisões do usuário (2026-11-25)

- Os links que importam são os das páginas no Backstage (não os de código no GitHub).
- Renomear ou mover uma página publicada: o redirecionamento entra **sozinho, com um aviso** ("O endereço antigo de
  deploy.md continua funcionando: ele leva para deploy-to-prod.md"), sem pergunta.

## Como funciona

### Página publicada

Publicada é a página que existe na branch principal do repositório remoto (`origin/main`, ou a branch padrão),
conferida pelo Git local, sem rede (`git cat-file -e origin/<branch>:<caminho>`). Sem Git ou sem remoto, a extensão
não sabe: conta como publicada (um redirecionamento a mais é uma linha; um link quebrado é um time divulgando de
novo).

### Renomear e mover (árvore e Explorer)

- Para cada página publicada que muda de caminho (renomear, mover para outra seção, mover uma seção inteira, que
  leva várias páginas), entra `antigo.md: novo.md` no `redirect_maps`, e `- redirects` em `plugins` se faltar
  (depois do `techdocs-core`).
- Sem cadeia: redirecionamentos que apontavam para o caminho antigo passam a apontar para o novo.
- Voltar a um caminho antigo (renomear de novo para o nome de antes) tira a entrada daquele caminho: uma página que
  existe não pode ser redirecionada.
- Entra no mesmo Desfazer da operação (árvore: o botão do aviso; Explorer: Ctrl+Z), que tira as entradas junto.
- O aviso do fim da operação ganha a frase "O endereço antigo continua funcionando" (ou "Os N endereços antigos
  continuam funcionando"), com o botão **Ver no mkdocs.yml**.

### Apagar

- Página publicada: a pergunta antes de apagar ganha a escolha do destino do endereço antigo: **outra página**
  (lista das páginas do site, a seção da página em primeiro), **a página inicial**, ou **sem destino** (o link
  quebra). A escolha padrão é a página inicial da seção, quando há.
- Apagar uma seção com páginas publicadas: a mesma pergunta, uma vez, para todas.
- Desfazer tira as entradas junto.

### Criar uma página num caminho antigo

Criar uma página (árvore, template, Explorer) num caminho que está no `redirect_maps` tira a entrada: a página nova
ocupa o endereço.

### Enviar

Nada de novo: o `mkdocs.yml` já vai junto. A tela de envio mostra, nos itens, "N endereços antigos continuam
funcionando" quando o envio leva redirecionamentos novos.

### Verificação (achados novos)

| Código | Gravidade | O que é | Ajuste automático |
|--------|-----------|---------|-------------------|
| `redirect-target-missing` | erro | O destino de um redirecionamento não existe no `docs_dir` | Não (só a pessoa sabe o destino certo); o item abre o `mkdocs.yml` na linha |
| `redirect-chain` | aviso | Um redirecionamento leva a outro | Sim: aponta direto para o fim da cadeia |
| `redirect-shadowed` | aviso | O caminho antigo existe como página | Sim: tira a entrada |
| `redirects-plugin-missing` | erro | Há `redirect_maps` sem `- redirects` em `plugins` | Sim: liga o plugin |

## Itens

| Item | Parte | O que entrega | Situação |
|------|-------|---------------|----------|
| LP1 | Prova | Num site de teste no Backstage local: `- redirects` com `redirect_maps`, `mkdocs build --strict`, o link antigo abre a página nova pelo aviso de 3 s. Também com seção movida (várias entradas) e com `use_directory_urls`. Anotar a versão mínima do `techdocs-core` que traz o plugin, para o README | ⬜ |
| LP2 | Núcleo | Regras puras: acrescentar e tirar entradas do `redirect_maps` mantendo comentários, ligar o plugin, encurtar cadeias, tirar a entrada de um caminho que voltou a existir; os quatro achados novos de `checkSite` | ⬜ |
| LP3 | Publicada | Saber se um caminho existe na branch principal do remoto, pelo Git local; sem Git, conta como publicada | ⬜ |
| LP4 | Renomear e mover | Árvore e Explorer gravam os redirecionamentos das páginas publicadas, no mesmo Desfazer, com o aviso e **Ver no mkdocs.yml** | ⬜ |
| LP5 | Apagar | A escolha do destino na pergunta de apagar; Desfazer tira as entradas | ⬜ |
| LP6 | Criar | Página nova num caminho antigo tira a entrada | ⬜ |
| LP7 | Enviar | A tela de envio conta os endereços antigos mantidos | ⬜ |
| LP8 | Navegador | Funciona no vscode.dev (o Git local não existe lá: conta como publicada) | ⬜ |
| LP9 | Documentação | README e README.pt-BR (renomear sem quebrar links, o aviso do Backstage, a versão mínima do techdocs-core), CHANGELOG, GIF de renomear uma página e abrir o endereço antigo | ⬜ |

## Decisões de quem escreveu a spec (o usuário pode mudar)

- **Sem Git, conta como publicada:** errar para o lado de manter o link.
- **Destino padrão ao apagar:** a página inicial da seção (ou a do site); "sem destino" existe, mas não é o padrão.
- **Sem configuração para desligar** na primeira versão: o redirecionamento é uma linha no `mkdocs.yml` e quem não
  quiser apaga a linha. Se o time pedir, entra uma opção na janela Configurações (para o time / só para mim).
- **O plugin é ligado sozinho** na primeira vez que um redirecionamento entra, no mesmo diff/Desfazer.

## Restrições

- Só `mkdocs-redirects`, pelo `mkdocs.yml`: nada no site além do que o TechDocs monta (pipeline agnóstica).
- O `mkdocs.yml` continua como a pessoa escreveu: comentários e ordem das chaves ficam (como nas outras edições
  do `nav`).
- Sem rede para saber se a página foi publicada.

## Testes

- Núcleo (unitários): entradas novas e retiradas, com comentários; cadeia encurtada; caminho que volta a existir;
  plugin ligado uma vez; os quatro achados e os ajustes.
- Integração (VS Code e navegador): renomear e mover pela árvore e pelo Explorer, uma página publicada e uma não
  publicada (repositório com `origin` local); seção movida; apagar com destino; Desfazer de cada um.
- Cenário visual: renomear uma página publicada, enviar, e o `mkdocs build --strict` do site com o endereço antigo
  gerando a página de redirecionamento.

## Deixado para quem constrói

- Onde mostrar a escolha do destino ao apagar (a pergunta de hoje é uma notificação modal; pode virar a janela na
  seção TechDocs, como as outras escolhas).
- Como o Explorer (Ctrl+Z) e a árvore dividem o código que grava os redirecionamentos.
