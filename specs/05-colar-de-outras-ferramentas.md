# 05 — Colar do Confluence e do Outline

## Problema

Quem leva documentação para o TechDocs quase nunca começa do zero: copia páginas do Confluence ou do Outline e
cola no editor visual. Hoje a colagem passa pelo comportamento padrão do Milkdown (o HTML colado vira os nós que
ele reconhece), sem nada próprio para essas ferramentas. O resultado parece certo no editor, mas o Markdown salvo
quebra no site do MkDocs ou fica cheio de sujeira.

## Objetivo

Colar uma página do Confluence (Data Center e Cloud) ou do Outline no editor visual e salvar um Markdown que o
MkDocs gera certo, sem depender da ferramenta de origem (imagens, links internos), e que passa no lint ou que o
**Conferir** ajusta sozinho.

Fora do escopo por enquanto: importar um espaço inteiro (várias páginas e o `nav`) e colar no editor de texto
Markdown (C12).

## Como foi testado (2026-11-03)

Ctrl+C real em páginas públicas, num navegador automatizado, e Ctrl+V na página de teste do editor
(`packages/ui/e2e/harness`); o Markdown salvo (`fromEditor`) passou pelo lint e o comportamento do MkDocs foi
conferido com o Python-Markdown.

- Confluence (Data Center, cwiki.apache.org): *KIP-500* (sumário, Jira, imagens) e *Hive LanguageManual DDL*
  (118 blocos de código, 61 painéis, 26 tabelas).
- Outline (docs.getoutline.com): *Blocks* (avisos) e *Sharing* (imagens com legenda, seções).

O Confluence Cloud gera outro HTML: falta testar.

## Itens

| Id | Origem | Problema | Correção | Estado |
|----|--------|----------|----------|--------|
| C1 | Todos (também sem colar) | O editor grava `\&` nos endereços (`?a=1\&b=2`) e `\@` nos e-mails; o Python-Markdown mantém a barra: link e imagem quebram, o e-mail aparece com `\` | `fromEditor` tira a barra antes de `&` (quando não forma uma entidade, como `&amp;`) e de `@`, fora do código | ✅ |
| C2 | Confluence | Bloco de código (macro *code*: `<span data-ds--code--code-block><code>`, sem `<pre>`) vira código inline numa linha só | Na colagem, o bloco vira `<pre><code class="language-…">` com o texto e as quebras de linha; também o `pre.syntaxhighlighter-pre` das versões antigas | ✅ |
| C3 | Ambos | Imagens apontam para a origem: `/download/attachments/…` do Confluence (pede login) e S3 assinado do Outline (expira em 1 h); sem texto alternativo | A extensão baixa cada imagem colada (http/https, até 20 s, até `images.maxSizeMB`) e grava em `docs/assets` como o envio de imagem; sem acesso (login, fora do ar, HTML no lugar da imagem), avisa e mantém o endereço. Texto alternativo: a legenda (`title`) ou o nome do arquivo (nomes como `image.png` e `a.png` ficam sem). O editor repete o texto alternativo como título (dica no site) | ✅ |
| C4 | Ambos | Painéis do Confluence (info, nota, aviso, dica) e avisos do Outline viram parágrafos; o título do painel vira parágrafo em negrito (MD036) | Viram admonition do MkDocs (`!!! info`, `!!! note`, `!!! warning`, `!!! tip`; Cloud `error` → `danger`, `success` → `success`) com o título do painel; o corpo leva parágrafos, listas, código, negrito, itálico e links. No editor, aparece no bloco `mkdocs` dos avisos | ✅ |
| C5 | Confluence | O sumário (macro *toc*) vira lista de links absolutos de volta ao Confluence | Tirar (o MkDocs gera o sumário) | |
| C6 | Confluence | Item do Jira vira `~~![](…viewavatar…)KAFKA-9119~~ … **Resolved**` | Fora do escopo (decisão de 2026-11-03): a colagem não trata o Jira | — |
| C7 | Confluence | Títulos com negrito dentro: `### **Create Database**` | Tirar o negrito que cobre o título inteiro | |
| C8 | Confluence | Tabelas largas: células completadas com espaços até a maior (linhas com mais de 400 caracteres) | Tabela compacta no Markdown salvo (sem alinhar as colunas) quando a linha passa de um limite | |
| C9 | Outline | Seções são H1: vários H1 na página (MD025); o título da página não vem junto | Rebaixar os títulos colados um nível quando a página já tem H1 | |
| C10 | Outline | Legenda da imagem duplicada (no `title` e num parágrafo) | Manter só como texto alternativo/legenda | |
| C11 | Ambos | Espaços no fim das linhas e dentro de trechos de código; realce de cor perdido | O lint e o Conferir já ajustam o espaço; realce fica de fora | |
| C12 | Editor de texto | Colar no Markdown (texto) cola o texto puro | "Colar como Markdown" no editor de texto, com as mesmas conversões | |

## Testes

- Unitários (`core`): C1 no `fromEditor`.
- Editor no navegador (`npm run test:editor`): colar o HTML de cada caso, recortado das páginas públicas
  testadas (só a estrutura, sem conteúdo privado), e conferir o Markdown salvo.
