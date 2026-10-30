# 03 — Testes, segurança, desempenho e release

## Testes

| Suíte | Ferramenta | O que cobre |
|-------|------------|-------------|
| Unitários | Vitest ou Jest | Escolha do modo, `FileSystemProvider` remoto, precedência da configuração, URI handler, mensagens |
| Editor | Playwright sobre o harness do `ui` (herdado do plugin) | Spec 01: inserir **e** remover cada componente, páginas reais da wiki voltando byte a byte, cursor de lista determinístico, HTML hostil |
| Extensão (desktop) | `@vscode/test-electron` | Abrir no visual sem gerar alteração, editar, Ctrl+Z, salvar, reabrir no texto; diagnostics e code actions; "ver linha"; imagens em `assets/` |
| Extensão (web) | `@vscode/test-web` | O mesmo no build `browser` |
| Publicação | GitHub simulado (cópia do `fake-github.ts` do plugin, adaptada para interceptar o `fetch` do host da extensão) | Todos os cenários do `test:editor:portal`: estados e botões, rascunho com `[skip ci]`, checks atrasados que não podem reaparecer, conflito, sem permissão, token trocado, 304, polling sem foco. Chamada não simulada reprova o teste |
| Ida e volta | `roundtrip-check` | Docs reais antes de cada release (M7 da spec 01) |

Regras herdadas:

- Todo bug corrigido ganha teste que reprovava antes.
- Teste com cache e interceptação: lembrar que o Playwright desliga o cache ao interceptar (bug L21
  passou despercebido); no host da extensão, testar o ETag no GitHub simulado.
- Teste de corrida é determinístico (atrasar a resposta no simulado), nunca `sleep`.
- Toda funcionalidade testada inserindo **e** removendo; textos em inglês e pt-BR.

### Quando cada suíte roda (2026-10-30)

A suíte completa (~6 min local e ~6 min no CI) só roda na publicação. No dia a dia, só o que a mudança toca:

| Quando | O que roda | Tempo |
|--------|------------|-------|
| A cada edição (hook do Claude Code, `.claude/hooks/test-after-edit.sh`) | Typecheck incremental (estado do `tsc` em `node_modules/.cache`) e os unitários ligados ao arquivo editado (`vitest related`). Sem build nem webview: não disputa o `dist/` com os testes do VS Code | ~5–8 s |
| Durante a feature (à mão) | Só o teste da mudança: `TEST_GREP=<texto> npm run test:vscode`, o spec no Playwright (`npx playwright test -c <config> <arquivo>`), o webview só quando a mudança mexe nele, `npm run test:scenarios -- <nº>` quando muda um fluxo de usuário | 20 s a 1 min |
| Commit (`.githooks/pre-commit`) | Typecheck e todos os unitários | ~10 s |
| Push de branch | Nada local. No CI, só o job rápido: typecheck, unitários, webview e tamanho do bundle | ~2 min no CI |
| Publicação (push da tag `v*`) | `.githooks/pre-push`: `npm run test:all`. No CI (`release.yml` chama o `ci.yml`): também as suítes do editor e do VS Code (desktop, web e e2e) | ~6 min local e ~6 min no CI |

As suítes lentas do CI também rodam à mão (`workflow_dispatch` do CI), por exemplo depois de uma mudança grande no
editor ou na publicação. Teste instável que aparece só na suíte completa é corrigido antes da release, não ignorado.

Testes e2e visuais (o VS Code com janela, como uma pessoa usaria: `npm run test:scenarios` sem `HEADLESS`, com o
relatório de capturas, ou os e2e com `HEADED=1`) só rodam quando o dono do projeto pede, em momentos que ele
escolhe. Ninguém os roda por conta própria durante o desenvolvimento.

## Segurança

| Área | Requisito |
|------|-----------|
| Webview | CSP estrita (`default-src 'none'`, scripts com nonce, `img-src` só `asWebviewUri`/`https:` da API do GitHub), `localResourceRoots` mínimos, sem `enableCommandUris` |
| Mensagens webview ↔ host | Tipadas e validadas no host; o webview nunca pede caminho arbitrário (só dentro do `docs_dir`) |
| Conteúdo | HTML hostil no Markdown (scripts, `javascript:`) não executa: reaproveitar `security.spec.ts` |
| Token | Fica no host (A-6 da spec 02); nunca no webview, log ou storage |
| Link `vscode://` | Parâmetros validados (B3 da spec 02) |
| Workspace não confiável | Sem ler `.markdownlint.*`/`.techdocs-editor.yaml` nem escrever até a pessoa confiar |
| Dependências | `npm audit`/`yarn npm audit` falhando em alta/crítica, Dependabot (só minor/patch, agrupado), age gate de versões novas |
| Código e segredos | CodeQL e gitleaks no CI |
| Cadeia de fornecimento | Actions por SHA, SBOM no `.vsix` de cada release (provenance no npm quando `core`/`ui` forem publicados, fase 7) |

## Desempenho

- Ativação só por `workspaceContains:**/mkdocs.yml`, pelo custom editor, pelos comandos e pelo URI
  handler; nunca `*`.
- Bundle com esbuild: um para o host (Node), um para o host web, um para o webview; Milkdown carregado
  só no webview.
- Medir e registrar no CI: tamanho do `.vsix`, tempo de ativação, tempo para abrir uma página
  grande no visual. Limite inicial: `.vsix` < 5 MB, abrir < 1 s numa página de 1.000 linhas.
- Lint com debounce; em página grande, só sobre o trecho alterado.

## Versões fixas

| O quê | Como |
|-------|------|
| `engines.vscode` | A versão mínima que tem todas as APIs usadas; CI testa a mínima e a estável |
| Pacotes | Lockfile com instalação imutável no CI; `dedupe --check`; `core` e `ui` como workspaces deste repositório (empacotados no `.vsix`, não publicados no npm até a fase 7) |
| Node | `.nvmrc` (24) |
| Milkdown | Versão exata (o `listCaretFix` depende do comportamento da 7.22.3: rever a cada atualização) |
| markdownlint | A mesma do núcleo, alinhada com a action da pipeline |

## Qualidade do código

- `knip` no CI (código, exports e dependências sem uso).
- Aviso do bundler é bug (lição do overlay do Backstage).
- Lint e `tsc` limpos; nenhum `any` sem motivo.
- Comentários e textos de interface em pt-BR no código; textos da extensão em inglês por padrão, com
  `package.nls.json` + `package.nls.pt-br.json` e `l10n/bundle.l10n.pt-br.json` (como a wsl-manager).

## Release

| Item | Como |
|------|------|
| Versionamento | SemVer, Changesets, CHANGELOG |
| Publisher | `edtroleis`, verificado no Marketplace |
| Publicação | Workflow de release: `vsce publish` (Marketplace) e `ovsx publish` (Open VSX), com o mesmo `.vsix`; tokens como segredos do ambiente de release com aprovação manual |
| Pré-release | Canal pre-release do Marketplace para as fases 2 a 5 |
| Documentação | README em inglês + `README.pt-BR.md`, GIFs gravados pelos testes (como o `yarn record:videos` do plugin), seção de segurança (escopos, OAuth Apps da organização) |
| Licença | Apache-2.0, `THIRD_PARTY_NOTICES.md` para o markdownlint empacotado |

### Versão de teste antes de cada release

Antes de cada release no GitHub (antes da tag `v*`), gerar um `.vsix` de teste e instalar no VS Code do dono do
projeto (`npx vsce package --no-dependencies` em `packages/extension`, depois `code --install-extension <arquivo>.vsix`).
A versão de teste usa um número que não vai para o Marketplace, como a 0.6.99 antes da 0.7.0. A tag só sai depois
que ele testar e aprovar; quando a release sai, a versão do Marketplace substitui a de teste.
