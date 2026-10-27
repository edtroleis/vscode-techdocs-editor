# 02 — Modos, autenticação, publicação e configuração

## Escolha do modo

`techdocsEditor.mode: auto | local | remote` (padrão `auto`):

| Situação | Modo |
|----------|------|
| `.md` dentro do `docs_dir` de um `mkdocs.yml` num workspace em disco | Local |
| Link `vscode://edtroleis.techdocs-editor/open?…` (portal) ou comando "TechDocs: abrir documentação do GitHub…" | Remoto |
| Workspace virtual (vscode.dev) | Remoto (ver A2 na spec 00) |

Uma doc aberta no modo remoto cujo repositório já está clonado no workspace mostra a opção "Abrir a
cópia local".

`package.json`: `capabilities.virtualWorkspaces` e `untrustedWorkspaces` declarados (no modo
restrito, só leitura e visual; sem lint com config do repositório até confiar).

## Modo local

| # | Requisito |
|---|-----------|
| LC1 | Ativação por `workspaceContains:**/mkdocs.yml`; resolve `docs_dir` e as páginas como o MkDocs (`<p>.md` → `<p>/index.md` → `<p>/README.md`, F9) |
| LC2 | Ctrl+S salva o arquivo (nada de commit); Git pelo controle de versão do VS Code |
| LC3 | Imagens gravadas em `<docs>/assets/<timestamp>-<nome>` com `workspace.fs`, link relativo à página (E4) |
| LC4 | Conflitos: os do Git, no editor de merge do VS Code. O editor visual não abre arquivo com marcadores de conflito: oferece abrir no texto |
| LC5 | Painel de publicação **opcional** (`techdocsEditor.local.publishPanel`): para quem quer o fluxo do plugin sem sair do VS Code. Usa a extensão Git do VS Code (`vscode.git`, API 1) para branch, commit e push, e a API do GitHub para PR e checks (mesmo fluxo da seção Publicação) |
| LC6 | Árvore "Documentação" na barra lateral: páginas do `docs_dir` pelo `nav` do `mkdocs.yml` (ou pastas, sem `nav`) |

## Modo remoto

| # | Requisito | Origem |
|---|-----------|--------|
| M1 | Sem clone e sem Git local: tudo pela API do GitHub, com o `github.ts` do `core` | D4 da demo |
| M2 | `FileSystemProvider` no esquema `techdocs:` (`techdocs://<host>/<owner>/<repo>/<caminho>`): leitura da branch do rascunho da pessoa, se existir, senão da `main` | X4 |
| M3 | **Ctrl+S = Salvar rascunho**: commit na branch `docs/<login>/<arquivo>` (F1), com `[skip ci]` só onde há pipeline | F2, F4 |
| M4 | Texto não salvo sobrevive a fechar o VS Code (hot exit) | F3 |
| M5 | Grava sempre sobre o SHA em que o texto se baseia; 409 → "Esta página mudou enquanto você editava" com a tela de conflito (`merge3`: aplica sozinho o que não se sobrepõe, a pessoa escolhe o resto) | L16, F8 |
| M6 | Imagens: commit em `<docs>/assets/` na branch do rascunho; exibidas lendo da branch (funciona em repositório privado) | E4 |
| M7 | Histórico da página e Restaurar (vira alteração nova, passa por PR) | F25 |
| M8 | Sem permissão de escrita (`push: false`): abre só leitura, com "Peça acesso a *owner*" | Spec 01 da demo |
| M9 | PR aberto de outra pessoa na mesma página: aviso com autor e link; PR da própria pessoa feito fora do editor: aviso próprio | F16, F26 |

## Publicação (modo remoto e painel opcional do local)

Mesmo fluxo e mesmos estados do plugin (spec 02 da demo), num painel (`WebviewView`) ao lado do
editor:

| Ação | No GitHub |
|------|-----------|
| Salvar rascunho | Commit na branch, `[skip ci]` onde há pipeline, sem lint e sem PR |
| Salvar e verificar | Correções automáticas do lint; trava só o que sobra. Commit (ou commit vazio depois de um rascunho); PR **draft** na 1ª vez |
| Enviar para publicação / revisão | O mesmo + PR pronto + link. **Sem merge** (X7). Rótulo pelo ruleset: 0 aprovações → publicação, ≥1 → revisão (F7) |
| Descartar | Confirmação; fecha o PR e apaga a branch |

Regras herdadas das lições:

| # | Regra | Origem |
|---|-------|--------|
| P1 | Verificações somem no clique; só aparecem as do commit recém-gravado; resposta de consulta iniciada antes de salvar é descartada | L18, F13 |
| P2 | Checks de qualquer CI: *check runs* **e** *commit statuses*; checks obrigatórios de rulesets **e** da branch protection clássica | 0.2.0 |
| P3 | Sem jobs pulados e só apontamentos `failure` nos arquivos de docs; regras do markdownlint e `checkHelp` em linguagem simples, com "ver linha" (anotações dos check runs; status só têm link) | F12, F15 |
| P4 | Nada de "Iniciando…" para sempre: sem check em `startTimeoutSeconds`, aviso + link do PR | Spec 08 da demo |
| P5 | Falha ao consultar a pipeline aparece no painel | F14 |
| P6 | Cenários: com checks obrigatórios / com pipeline sem obrigatórios / sem pipeline (lint do editor é a verificação) — `verification.mode: auto` detecta | Spec 08 da demo |
| P7 | Para admin sem a configuração mínima: "Configurar verificações" (`planSetup`/`applySetup` do `core`), pedindo o escopo `workflow` só nessa hora | Fase 7 do plugin |
| P8 | Polling: 8 s com check rodando ou PR esperando, 60 s parado, **nada** sem a janela em foco (`window.state.focused`), consulta na hora ao voltar | Fase 6 do plugin |
| P9 | Todo GET com ETag (`If-None-Match`); 304 não conta no limite do GitHub | Fase 6 do plugin |

## Autenticação

| # | Requisito |
|---|-----------|
| A-1 | `vscode.authentication.getSession('github', scopes, { createIfNone })` só quando precisa agir; leitura de repositório público sem pedir login |
| A-2 | GitHub Enterprise pelo provedor `github-enterprise` (configuração `github-enterprise.uri` do VS Code); host e API pela URL da doc ou por `techdocsEditor.github.host` |
| A-3 | Escopos mínimos: `repo` (ou `public_repo` para wikis públicas, `techdocsEditor.github.scopes`); `workflow` só no "Configurar verificações" |
| A-4 | Token lido da sessão a cada chamada; 401 → nova sessão (`forceNewSession`) e uma nova tentativa (lição do "Bad credentials" do plugin) |
| A-5 | SAML/SSO e restrição de OAuth Apps da organização: mensagem clara dizendo o que pedir ao admin (A1 da spec 00) |
| A-6 | Token nunca no webview, em log, em `globalState` ou em `SecretStorage` próprio: as chamadas ao GitHub saem do host da extensão |

## Configuração

Settings do VS Code com os mesmos nomes do `app-config` do plugin, para quem já conhece:

```jsonc
{
  "techdocsEditor.mode": "auto",                    // auto | local | remote
  "techdocsEditor.openVisualByDefault": "remote",   // never | remote | always
  "techdocsEditor.local.publishPanel": false,
  "techdocsEditor.github.host": "github.com",
  "techdocsEditor.github.scopes": ["repo"],
  "techdocsEditor.branchPattern": "docs/{login}/{path}",
  "techdocsEditor.drafts.skipCi": true,
  "techdocsEditor.verification.mode": "auto",       // auto | pipeline | editor
  "techdocsEditor.verification.startTimeoutSeconds": 120,
  "techdocsEditor.verification.checkHelp": {},
  "techdocsEditor.images.maxSizeMB": 5,
  "techdocsEditor.polling.intervalSeconds": 8,
  "techdocsEditor.polling.idleIntervalSeconds": 60
}
```

Precedência para `verification.*`: `.techdocs-editor.yaml` do repositório (main), depois as
settings, depois o padrão. `checkHelp` do repositório soma ao das settings (o repositório vence
para o mesmo job). Valor inválido é ignorado, com aviso no canal de saída: um erro de digitação não
trava o editor (mesma regra do plugin).

## Integração com o Backstage

B1, B3 e B4 são da extensão (fases 4 e 5). B2 mexe no plugin e fica para a fase 7.

| # | Requisito |
|---|-----------|
| B1 | `window.registerUriHandler`: `vscode://edtroleis.techdocs-editor/open?host=<h>&repo=<owner/repo>&path=<arquivo>` abre a página no modo remoto (ou na cópia local, se o repositório estiver no workspace) |
| B2 | No plugin: opção "Abrir no VS Code" no lápis (configurável, desligada por padrão), com o mesmo link; vscode.dev quando A3 da spec 00 estiver resolvido |
| B3 | Parâmetros do link validados (host da lista de `integrations`/settings, `owner/repo` e caminho sem `..`); nunca executam nada além de abrir |
| B4 | Dev Spaces: devfile de exemplo com a extensão e `techdocsEditor.openVisualByDefault: always` |
