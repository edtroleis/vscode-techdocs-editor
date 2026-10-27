# Como editar esta wiki

Você edita as páginas direto no portal, num editor parecido com um editor de texto comum. Não precisa instalar nada nem conhecer Git.

## Quem pode editar

O lápis **Editar** aparece ao lado da engrenagem, no alto da página, para quem tem permissão de escrita nesta wiki. Na primeira vez, o portal pede para você entrar com a sua conta do GitHub.

Se o lápis não aparece, peça acesso ao time responsável pela wiki.

## Abrir o editor

1. Abra a página que você quer alterar.
2. Clique no lápis **Editar**.

Um ponto no lápis indica que você tem um rascunho dessa página guardado. Clique para continuar de onde parou.

## Escrever

O editor abre no modo **Visual**: escreva como num editor de texto.

| Para                                           | Faça                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| Negrito, itálico, link                         | Selecione o trecho e use a barra que aparece sobre ele |
| Título, lista, tabela, citação, código, imagem | Digite `/` numa linha vazia e escolha o bloco          |
| Usar os botões                                 | Use a barra fixa no alto do editor                     |
| Desfazer                                       | Ctrl+Z (refazer: Ctrl+Y)                               |
| Procurar um texto                              | Ctrl+F                                                 |
| Ver ou voltar versões anteriores               | Botão **Histórico**, acima do editor                   |

O modo **Markdown** mostra a página como ela fica guardada. Use se quiser ajustar algo à mão; as duas visões mostram o mesmo conteúdo.

!!! tip "Formatação conferida na hora"
    O editor confere a formatação enquanto você escreve, com as mesmas regras da publicação. O que puder ser ajustado sozinho é corrigido ao verificar; o resto aparece na lateral, com o botão **ver linha**.

## Salvar e publicar

Os botões ficam na lateral do editor. Passe o mouse sobre cada um para ver o que ele faz.

| Botão                      | O que acontece                                                                                     | Quem vê                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Salvar rascunho**        | Guarda o que você escreveu, sem verificar nada                                                     | Só você                                     |
| **Salvar e verificar**     | Guarda e roda as verificações automáticas: formatação, links, dados sensíveis e montagem da página | Só você e quem abrir o pedido de publicação |
| **Enviar para publicação** | Envia a alteração para quem cuida da wiki publicar                                                 | O time                                      |
| **Descartar rascunho**     | Apaga as alterações que ainda não foram publicadas                                                 | —                                           |

Quando a wiki exige aprovação, o botão de envio se chama **Enviar para revisão**: alguém do time precisa aprovar antes de publicar.

O envio só é liberado depois de **Salvar e verificar**, com todas as verificações aprovadas.

## Acompanhar

A etiqueta no alto da lateral mostra em que ponto a alteração está:

| Etiqueta                           | Significado                                                       |
| ---------------------------------- | ----------------------------------------------------------------- |
| Alterações não salvas              | Há texto que ainda não foi guardado                               |
| Rascunho salvo, não verificado     | Guardado; falta verificar                                         |
| Rascunho                           | Verificado; pronto para enviar                                    |
| Precisa de ajustes                 | Alguma verificação encontrou um problema; corrija e salve de novo |
| Aguardando publicação / Em revisão | Enviado; falta quem cuida da wiki publicar                        |
| Publicado                          | Pronto! A página nova aparece no portal em 1 a 2 minutos          |

Na página da wiki, um ícone com um número avisa que há alterações aguardando publicação. Passe o mouse para ver quais são.

## Quando duas pessoas editam a mesma página

Cada pessoa tem o próprio rascunho, então ninguém apaga o trabalho de ninguém. Se outra alteração da mesma página for publicada enquanto você edita:

- se vocês mexeram em partes diferentes, o editor junta as duas sozinho;
- se mexeram no mesmo trecho, o editor mostra as duas versões e você escolhe o que fica.

## Cancelar um envio

Enquanto a alteração não foi publicada, abra o editor na página e clique em **Descartar rascunho** (a lixeira, na lateral). O pedido de publicação é cancelado e o editor volta ao texto publicado.

Se você abriu a alteração direto no GitHub, fora do editor, o editor mostra um aviso com o link: para cancelar, feche o pull request no GitHub.

## Voltar a uma versão anterior

Clique em **Histórico**, acima do editor, para ver as versões publicadas da página, da mais nova para a mais antiga. **Restaurar** coloca o texto daquela versão no editor; para publicar, salve, verifique e envie como numa edição normal.

Para desfazer o que você escreveu e ainda não salvou, restaure a versão mais recente (marcada como "publicada agora").

## Datas da página

No alto de cada página, à esquerda do lápis, aparecem a **Última atualização** e a **Data de criação**, com dia e hora. Elas mudam sozinhas quando uma alteração é publicada.
