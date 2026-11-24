# Clonar e Enviar (0.19.0) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A doc fica sempre num diretório do computador (clonada ou criada ali), Ctrl+S só grava, e **Enviar (N)** manda tudo o que mudou na documentação do repositório num pedido de revisão só, acompanhado até entrar na branch principal; saem o modo remoto e o painel por página.

**Architecture:** A lógica pura fica no `core` (`sendItems.ts`: o que é arquivo da documentação, os itens do envio, o resumo) e no host sem `vscode` (`send/sender.ts`, máquina de estados testada com `FakeGit`/`FakeGitHub`, no molde do `LocalPublisher`). O Git é o `vscode.git` (API 1) por trás de uma interface `RepoGit`, que amplia o `LocalGit` de hoje. Duas webviews: a tela de envio (`WebviewPanel`, telas 2/6/15) e o painel Envio (`WebviewView`, telas 4/9/10/14). Clonar (telas A/B) e criar o repositório são fluxos de `QuickPick`/progresso no host.

**Tech Stack:** TypeScript, VS Code API (`vscode.git` API 1, `authentication`, `WebviewPanel`/`WebviewView`, `FileDecorationProvider`), `GitHubClient` do `core`, Vitest, `@vscode/test-electron` (`test:vscode`), Playwright (cenários `test:scenarios`).

**Spec:** `specs/09-enviar.md` (U1–U9, C1–C6). Protótipo: `C:\Users\Public\techdocs-prototipo-enviar\index.html`.

## Global Constraints

- Commits só em nome do usuário, sem `Co-Authored-By`; mensagens em pt-BR no padrão do repositório (`feat(enviar): …`, `refactor: …`, `docs(specs): …`).
- Branch de trabalho `feat/enviar` no worktree `~/code/vscode-techdocs-editor-templates` (base: main em `91fbe75`).
- Textos em pt-BR e en (`vscode.l10n.t` + `l10n/bundle.l10n.pt-br.json` e `package.nls*.json`); em pt-BR "diretório", nunca "pasta".
- **Nenhum termo do Git nos textos para quem escreve** (branch, commit, push, PR, merge, rebase). Usar "envio", "pedido de revisão", "branch principal" só na descrição das configurações.
- Token nunca no webview, log, `globalState` ou `SecretStorage` próprio (A-6): toda chamada ao GitHub sai do host.
- Nunca apagar alteração da pessoa sem confirmação; nunca levar no envio arquivo fora da documentação.
- Sem merge pela extensão (X7).
- Testes: rodar só o da mudança (`timeout 120 npx vitest run <arquivo>`, `timeout 300 npm run test:vscode -- --grep "<nome>"`); `test:all` só na release, com o anti-suspensão do Windows. Todo comando com limite de tempo duro; se parar, matar e investigar.
- Configurações novas, exatas: `techdocsEditor.send.target` (`"pullRequest"` | `"main"`, padrão `"pullRequest"`), `techdocsEditor.clone.directory` (padrão `"~/Documents/TechDocs"`), `techdocsEditor.branchPattern` (padrão `"docs/{login}/{date}"`, `{date}` = `aaaammdd-hhmm` no horário local).
- Arquivos do site que vão junto além do `docs_dir` e do `mkdocs.yml`: `catalog-info.yaml`, `.markdownlint.yaml` (e os demais de `LINT_CONFIG_FILES`), `.techdocs-editor.yaml`, ao lado do `mkdocs.yml`.

## Review Focus

- **Doc com espaço, acento ou maiúscula no caminho** (`docs/Visão Geral.md`): entra na contagem, no envio e no Desfazer com o mesmo caminho (Task 1 e Task 4: teste com `docs/Visão Geral.md`).
- **Arquivo salvo e depois desfeito à mão** (texto voltou igual ao da principal): não conta como mudança, mesmo com o `mtime` novo (Task 3: `diffWith` compara conteúdo; teste no `FakeGit` com o texto igual ao da principal → N=0).
- **Enviar com o editor visual sujo** (texto não salvo): salva todos os documentos de docs abertos antes de calcular os itens; nada não salvo fica de fora em silêncio (Task 4: teste `send() salva antes`).
- **Rede cai no meio do envio** (depois do push, antes do PR): "Enviar de novo" não cria uma segunda branch nem um segundo PR; acha a branch e o PR existentes (Task 4: `failNext` no `createPullRequest`, depois `send()` → 1 PR).
- **Dois sites com o mesmo nome de página** (`docs/index.md` e `api/docs/index.md`): os itens são agrupados certo e o Desfazer de um não mexe no outro (Task 1 e Task 4).

---

### Task 1: Itens do envio no `core`

**Files:**
- Create: `packages/core/src/sendItems.ts`, `packages/core/src/sendItems.test.ts`
- Modify: `packages/core/src/index.ts` (exportar)

**Interfaces:**
- Produces:
  ```ts
  export type SendSite = { root: string; docsDir: string; mkdocs: string; title: string }; // caminhos relativos à raiz do repo, '/' , '' = raiz
  export type FileChange = { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; from?: string };
  export type SendItem =
    | { kind: 'page'; change: 'added' | 'modified' | 'deleted'; path: string; site: string; title: string }
    | { kind: 'moved'; from: string; path: string; site: string; title: string }
    | { kind: 'images'; paths: string[]; site: string; usedIn: string[] }   // usedIn = caminhos das páginas
    | { kind: 'menu'; path: string; site: string }                          // o mkdocs.yml mudou
    | { kind: 'siteFile'; path: string; site: string };                     // catalog-info.yaml etc.
  export type SendGroup = { site: SendSite; items: SendItem[] };
  export function siteOf(path: string, sites: SendSite[]): SendSite | undefined;   // o mais fundo que contém
  export function isDocsFile(path: string, sites: SendSite[]): boolean;
  export function sendGroups(changes: FileChange[], sites: SendSite[], pageText: (path: string) => string | undefined): { groups: SendGroup[]; outside: string[] };
  export function sendSummary(groups: SendGroup[], t: (msg: string, ...a: Array<string | number>) => string): string;
  export function itemCount(groups: SendGroup[]): number;
  export function itemPaths(item: SendItem): string[];  // arquivos que o item leva (moved: [from, path])
  ```

- [ ] **Step 1: Testes que falham** em `sendItems.test.ts`, com dois sites (`{root:'', docsDir:'docs', mkdocs:'mkdocs.yml', title:'Guia'}` e `{root:'api', docsDir:'api/docs', mkdocs:'api/mkdocs.yml', title:'API'}`):
  - `isDocsFile`: `docs/a.md`, `docs/assets/x.png`, `mkdocs.yml`, `catalog-info.yaml`, `api/.markdownlint.yaml`, `api/docs/index.md` → true; `src/x.ts`, `README.md`, `package.json` → false.
  - `siteOf('api/docs/index.md')` é o site `API`, não o `Guia`.
  - `sendGroups` com `docs/Visão Geral.md` modificado, `docs/faq.md` adicionado, `docs/v1.md` deletado, `docs/alertas.md`→`docs/operacao/alertas.md` renomeado, `docs/assets/a.png` e `docs/assets/b.png` adicionados (usados em `docs/Visão Geral.md` pelo `pageText`), `mkdocs.yml` modificado, `src/x.ts` modificado → um grupo `Guia` com 6 itens na ordem modificadas, novas, movidas, removidas, imagens, menu; `outside: ['src/x.ts']`; `itemCount` = 6; o título da página vem do `# ` (pelo `pageTitle` que já existe) ou do nome do arquivo (`nameToTitle`).
  - `docs/index.md` e `api/docs/index.md` modificados → dois grupos, um item em cada.
  - `sendSummary` em pt-BR com o `t` identidade: `"Atualiza Visão Geral; cria Perguntas frequentes"` para 1 modificada + 1 nova; dois sites: `"Guia: …. API: …"`.

- [ ] **Step 2:** `timeout 120 npx vitest run packages/core/src/sendItems.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar** `sendItems.ts`. Imagem = arquivo em `<docsDir>/` com extensão de imagem (`png jpg jpeg gif svg webp`); `usedIn` pelos links do `pageText` das páginas do envio (mesmo regex `LINKS` do `localPublisher.ts`, mover para cá e reexportar). Imagens sem página que as use vão num item `images` com `usedIn: []`.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(enviar): itens do envio pelo repositório inteiro, agrupados por site (core)`.

### Task 2: O que falta no `GitHubClient`

**Files:**
- Modify: `packages/core/src/github.ts`, `packages/core/src/github.test.ts`, `packages/core/test/fakeGitHub.ts`

**Interfaces:**
- Produces (métodos novos de `GitHubClient`):
  ```ts
  getIdentity(): Promise<{ login: string; name: string; emails: Array<{ email: string; primary: boolean }>; noreply: string }>; // /user + /user/emails; noreply = `${id}+${login}@users.noreply.github.com`
  listRepoOwners(): Promise<Array<{ login: string; org: boolean }>>;   // a conta + /user/orgs
  createRepository(opts: { owner: string; org: boolean; name: string; private: boolean }): Promise<{ slug: string; cloneUrl: string; defaultBranch: string }>;
  getReviewState(pr: number): Promise<{ state: 'waiting' | 'approved' | 'changesRequested'; by?: string }>; // último review de cada revisor
  ```
- Produces (`FakeGitHub`): suporte a `POST /user/repos`, `POST /orgs/:org/repos`, `GET /user/emails`, `GET /user/orgs`, `GET /repos/:slug/pulls/:n/reviews`, e `review(prNumber, login, state)` para os testes.

- [ ] **Step 1: Testes que falham** em `github.test.ts`: `createRepository` na conta faz `POST /user/repos` com `{name, private: true, auto_init: false}`; na organização, `POST /orgs/acme/repos`; `getIdentity().noreply === '123+msilva@users.noreply.github.com'` para `{id:123, login:'msilva'}`; `getReviewState` com `[{user:'ana',state:'CHANGES_REQUESTED'},{user:'ana',state:'APPROVED'}]` → `approved` por `ana`.
- [ ] **Step 2:** `timeout 120 npx vitest run packages/core/src/github.test.ts` → FAIL.
- [ ] **Step 3: Implementar** os quatro métodos e o suporte no `FakeGitHub`.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(enviar): GitHub cria o repositório, lê a identidade e o estado da revisão`.

### Task 3: `RepoGit`, o Git do repositório inteiro

**Files:**
- Modify: `packages/extension/src/publish/types.ts` (nova interface), `packages/extension/src/publish/vscodeGit.ts`
- Create: `packages/extension/test/fakeGit.ts` (o `FakeGit` do `localPublisher.test.ts` sai dali e ganha o que falta)
- Test: `packages/extension/test/vscode/suite/send.ts` (só os métodos que dependem do Git de verdade)

**Interfaces:**
- Consumes: `LocalGit` (types.ts), `FileChange` (Task 1).
- Produces:
  ```ts
  export interface RepoGit extends LocalGit {
    readonly root: string;                                   // fsPath da raiz
    defaultBranch(): string | undefined;                     // de origin/HEAD; undefined sem origin
    fetch(): Promise<void>;
    /** Arquivos diferentes entre `ref` e o HEAD + árvore de trabalho + não versionados, comparando conteúdo. */
    diffWith(ref: string): Promise<FileChange[]>;
    /** Merge de `ref` na branch atual; os caminhos em conflito ([] = juntou sozinho). */
    merge(ref: string): Promise<string[]>;
    /** Volta `paths` ao conteúdo de `ref` (o que não existe em `ref` é apagado), sem commit. */
    restoreFrom(ref: string, paths: string[]): Promise<void>;
    /** Volta à `branch` levando as mudanças de HEAD contra `base` como não commitadas; os caminhos em conflito. */
    unstackOnto(branch: string, base: string): Promise<string[]>;
    addRemote(name: string, url: string): Promise<void>;
    identity(): Promise<{ name?: string; email?: string }>;   // config efetiva (repo, senão global)
  }
  export async function initRepository(folder: vscode.Uri): Promise<RepoGit>;                       // vscodeGit.ts
  export async function setGlobalIdentity(name: string, email: string): Promise<void>;             // `git config --global` pelo `api.git.path`
  export async function cloneRepository(url: string, parent: vscode.Uri, name: string, progress: (pct: number) => void): Promise<vscode.Uri>;
  ```

- [ ] **Step 1: Testes que falham** em `send.ts` (suite do `test:vscode`, repositório temporário criado com `git init` + um `origin` local `--bare`): `diffWith('origin/main')` acha `docs/Visão Geral.md` modificado e `docs/novo.md` não versionado; um arquivo salvo de volta igual ao da principal não aparece; `restoreFrom('origin/main', ['docs/novo.md'])` apaga o novo; `merge` sem sobreposição devolve `[]`; `unstackOnto('main', 'origin/main')` deixa a `main` com as mudanças não commitadas.
- [ ] **Step 2:** `timeout 300 npm run test:vscode -- --grep "RepoGit"` → FAIL.
- [ ] **Step 3: Implementar** em `VscodeGit`: `fetch`, `merge`, `addRemote`, `getConfig`/`getGlobalConfig` pela API do `vscode.git` (ampliar o tipo `Repository` do arquivo com esses métodos e com `diffWith(ref)`/`show(ref, path)`); `diffWith` junta `repository.diffWith(ref)` com os não versionados e descarta os de conteúdo igual (`show(ref, path)` ↔ disco); `restoreFrom` escreve o `show` ou apaga com `workspace.fs`; `unstackOnto`: guarda o diff `base..HEAD` + árvore, `checkout(branch)`, reaplica arquivo a arquivo, e em conflito (o arquivo da `branch` mudou contra a `base`) não sobrescreve e devolve o caminho. `cloneRepository`: `api.clone` se existir na versão do VS Code, senão `execFile(api.git.path, ['clone', '--progress', …])` lendo o `%` do stderr. `setGlobalIdentity` pelo `api.git.path`.
- [ ] **Step 4:** mesmo comando → PASS. Mover o `FakeGit` para `test/fakeGit.ts` implementando `RepoGit` (em memória sobre o `FakeGitHub`), e rodar `timeout 120 npx vitest run packages/extension/src/publish/localPublisher.test.ts` → PASS (o publicador antigo ainda existe).
- [ ] **Step 5: Commit** `feat(enviar): Git do repositório inteiro (diff com a principal, juntar, desfazer, clonar)`.

### Task 4: `Sender`, a máquina do envio (sem `vscode`)

**Files:**
- Create: `packages/extension/src/send/sender.ts`, `packages/extension/src/send/sender.test.ts`

**Interfaces:**
- Consumes: `RepoGit` + `FakeGit` (Task 3), `sendGroups`/`itemPaths`/`sendSummary` (Task 1), `GitHubClient.getReviewState` (Task 2), `ChecksWatcher`, `Poller`, `summarize`, `failureHelp`, `parseAnnotation` do `core` (como o `LocalPublisher`).
- Produces:
  ```ts
  export type SendTarget = 'pullRequest' | 'main';
  export type SendState =
    | { status: 'idle'; groups: SendGroup[]; outside: string[]; count: number }
    | { status: 'sending'; step: 'saving' | 'updating' | 'uploading' | 'opening' }
    | { status: 'inReview'; pr: { number: number; url: string }; title: string; pending: number; // mudanças novas depois do envio
        checks: { summary: ChecksSummary; items: CheckView[] }; review: 'waiting' | 'approved' | 'changesRequested'; reviewer?: string; requiredApprovals: number }
    | { status: 'merged'; by?: string }
    | { status: 'conflict'; paths: string[] }
    | { status: 'offline'; retrying: boolean }
    | { status: 'cannotWrite'; repoUrl: string }
    | { status: 'error'; message: string };
  export type SenderOptions = {
    git: RepoGit; client: GitHubClient; sites: () => SendSite[]; target: SendTarget; branchPattern: string;
    saveAll: () => Promise<void>; pageText: (path: string) => string | undefined;
    l10n: L10n; confirm: (message: string, action: string) => Promise<boolean>; onChange: (s: SendState) => void;
    now?: () => Date; isOffline?: (e: unknown) => boolean;
  };
  export class Sender {
    constructor(o: SenderOptions);
    load(): Promise<void>;           // fetch, estado pela branch atual + PR aberto (C2)
    refresh(): Promise<void>;        // recalcula os itens (depois de salvar, de mudar de branch)
    send(summary: string): Promise<void>;     // passos do envio (spec "O envio"), também "Enviar de novo"
    undo(item: SendItem): Promise<void>;      // confirm + restoreFrom(origin/<principal>, itemPaths(item))
    giveUp(): Promise<void>;                  // C5
    setFocused(focused: boolean): void;       // P8
    dispose(): void;
  }
  export function envioBranch(pattern: string, login: string, now: Date): string; // 'docs/msilva/20261124-1830'
  ```

- [ ] **Step 1: Testes que falham** em `sender.test.ts` (`FakeGit` + `FakeGitHub`, dois sites como na Task 1):
  - `envioBranch('docs/{login}/{date}', 'msilva', new Date(2026,10,24,18,30))` → `'docs/msilva/20261124-1830'`.
  - Na `main`, 2 páginas mudadas + `src/x.ts`: `send('Atualiza A e B')` chama `saveAll` antes, cria `docs/msilva/…`, o commit tem só as 2 páginas, push, 1 PR pronto (não draft) com título `'Atualiza A e B'`; estado `inReview`; `src/x.ts` continua mudado e fora.
  - Numa branch `feature/x` de dev (C1): `send` não cria branch, abre o PR de `feature/x`.
  - Depois do envio, editar uma página → `pending: 1`; `send` de novo faz commit + push na mesma branch, sem PR novo.
  - `failNext('POST', /pulls$/, 502)` no primeiro `send`, depois `send` → 1 branch e 1 PR no total (Review Focus).
  - `origin/main` andou sem sobreposição → o envio junta e segue; com sobreposição → `{status:'conflict', paths:['docs/a.md']}` e nada enviado.
  - `canWrite: false` → `cannotWrite` antes de qualquer commit.
  - `target: 'main'` → commit e push na `main`, sem PR; push recusado (proteção, 403/`GH006`) → `error` com o texto de "este repositório exige revisão".
  - `undo` de uma página nova apaga o arquivo; de uma `moved` volta os dois caminhos; `confirm` false não mexe em nada; com `docs/index.md` e `api/docs/index.md`, desfazer um não muda o outro.
  - `giveUp` com o PR aberto: `confirm`, fecha o PR, apaga a branch no GitHub e a local, volta à `main` com as páginas mudadas e não commitadas (N igual ao de antes). Com conflito no `unstackOnto`: a branch local continua e o estado é `conflict`.
  - PR mesclado no `FakeGitHub` → no próximo `refresh` do poller: `merged` com `by`, a cópia em `main` atualizada e a branch local apagada.
  - Erro de rede (`isOffline` true) → `offline`; ao voltar (`setFocused(true)` + rede ok) com `retrying: true`, envia sozinho.
- [ ] **Step 2:** `timeout 120 npx vitest run packages/extension/src/send/sender.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `sender.ts`. Reaproveitar do `LocalPublisher` o uso do `ChecksWatcher`/`Poller`/`getBranchRules`/`hasWorkflows` (verificação por pipeline ou lint, P2–P6, P8–P9); a mensagem do commit é o resumo; o rótulo "Publicar" vs "Enviar para revisão" vem de `requiredApprovals` e do `target`.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(enviar): o envio do repositório inteiro, acompanhado até entrar na branch principal`.

### Task 5: Tela de envio (telas 2, 6, 15)

**Files:**
- Create: `packages/extension/src/send/sendPanel.ts`, `packages/extension/webview/send.ts`
- Modify: `packages/extension/build.mjs` (entrada `send`), `packages/extension/webview/webview.css`
- Test: `packages/extension/test/webview/send.spec.ts` (Playwright do webview com estado injetado, no molde dos specs de `test/webview`)

**Interfaces:**
- Consumes: `Sender` (Task 4), `fixLintProblems`/`lintFindings` e o `checkSite` do `core` para a conferência.
- Produces: comando `techdocsEditor.send` (abre a tela do repositório do site selecionado); mensagens webview→host `{type:'send', summary}`, `{type:'undo', index}`, `{type:'diff', path}`, `{type:'fix'}`, `{type:'open', path, line?}`, `{type:'cancel'}`; host→webview `{type:'state', groups, outside, checks: Array<{kind:'ok'|'fixable'|'blocking', text, path?, line?}>, summary, primary: 'review'|'publish'}`.

- [ ] **Step 1: Testes que falham** em `send.spec.ts`: com 2 grupos, desenha os cabeçalhos `Guia` e `API` com contagem e os rótulos ALTERADA/NOVA/MOVIDA/REMOVIDA/IMAGENS/MENU; "Desfazer" manda `{type:'undo', index:2}`; com um `blocking`, o botão principal fica desabilitado com o motivo; `outside` mostra "3 arquivos fora da documentação não vão neste envio"; nenhum texto da tela contém `branch`, `commit`, `push`, `pull request` (varrer o `innerText`, pt-BR e en).
- [ ] **Step 2:** `timeout 300 npm run test:webview -- send.spec.ts` → FAIL.
- [ ] **Step 3: Implementar.** "Ver o que mudou" = `vscode.diff` entre `git:`/`show(origin/<principal>)` e o arquivo. A conferência roda ao abrir e depois de cada "Corrigir"/salvar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(enviar): tela de envio com o que vai, Desfazer e a conferência`.

### Task 6: Painel Envio (telas 4, 9, 10, 14) e o Enviar (N)

**Files:**
- Create: `packages/extension/src/send/sendView.ts`, `packages/extension/webview/sendView.ts`, `packages/extension/src/send/sendDecorations.ts`
- Modify: `packages/extension/src/docsTreeView.ts` (título "Enviar N"), `packages/ui/src/topBar.ts` + protocolo do editor (`protocol.ts`: mensagem `sendCount`), `packages/extension/src/visualEditorProvider.ts`, `packages/extension/package.json` (view `techdocsEditor.send`, comando no título da árvore, barra de status)
- Test: `packages/extension/test/webview/sendView.spec.ts`, `packages/extension/test/vscode/suite/send.ts`

**Interfaces:**
- Consumes: `SendState` (Task 4), comando `techdocsEditor.send` (Task 5).
- Produces: `SendDecorations implements vscode.FileDecorationProvider` (laranja `M`/verde `N` nos arquivos dos itens; "em revisão" no `inReview`); contexto `techdocsEditor.sendCount`; barra do editor com botão **Enviar (N)** (`top-bar` item `send`) que executa `techdocsEditor.send`.

- [ ] **Step 1: Testes que falham:** `sendView.spec.ts` desenha `inReview` com "Esperando revisão", `checks` com falha mostra "Ver na linha", `merged` mostra "Aprovado e na branch principal" e **nenhum** "Backstage"; `send.ts` (vscode): com 2 páginas mudadas a árvore mostra "Enviar 2" e o arquivo tem a decoração `M`.
- [ ] **Step 2:** `timeout 300 npm run test:webview -- sendView.spec.ts` e `timeout 300 npm run test:vscode -- --grep "Enviar"` → FAIL.
- [ ] **Step 3: Implementar.** O botão novo da barra entra **depois** de Desfazer/Refazer, para não deslocar os índices 15/16 dos testes (ou trocar os testes para localizar por `data-key`, preferível: `undo.spec.ts`, `e2e/history.spec.ts`, `e2e/editing.spec.ts`, `test/vscode/suite/tests.ts`).
- [ ] **Step 4:** os dois comandos → PASS.
- [ ] **Step 5: Commit** `feat(enviar): Enviar (N) na árvore, no editor e na barra de status; painel Envio`.

### Task 7: Login, permissão, identidade e criar o repositório

**Files:**
- Create: `packages/extension/src/send/preflight.ts`, `packages/extension/src/send/createRepo.ts`
- Modify: `packages/extension/src/send/sendPanel.ts` (chama o preflight antes do `Sender.send`)
- Test: `packages/extension/test/vscode/suite/send.ts`

**Interfaces:**
- Consumes: `getIdentity`/`listRepoOwners`/`createRepository` (Task 2), `initRepository`/`setGlobalIdentity`/`addRemote` (Task 3), `clientFor` do `githubAuth.ts`.
- Produces: `export async function preflight(git: RepoGit | undefined, folder: vscode.Uri): Promise<{ git: RepoGit; client: GitHubClient; firstSend: boolean } | undefined>` — login (tela 5), sem `origin` → `createRepo` (dono, nome = nome do diretório, privado marcado), sem `user.name/email` → tela 13 (QuickPick com nome e os e-mails, o `noreply` por último com a explicação), `firstSend` true para repositório recém-criado (o `Sender` usa `target: 'main'` nesse envio).

- [ ] **Step 1: Testes que falham** (vscode, transporte de teste do `githubAuth`): diretório sem Git com `mkdocs.yml` + `src/a.ts` → cria o repositório privado na conta, `origin` ligado, o primeiro envio vai na `main` com só os arquivos da documentação (C4); sem identidade → grava `user.name`/`user.email` global com o escolhido.
- [ ] **Step 2:** `timeout 300 npm run test:vscode -- --grep "criar o repositório|identidade"` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5: Commit** `feat(enviar): criar o repositório no GitHub e o nome e e-mail na primeira vez`.

### Task 8: Clonar (telas A e B) e o link do Backstage

**Files:**
- Create: `packages/extension/src/clone/cloneFlow.ts`, `packages/extension/src/clone/knownClones.ts`
- Modify: `packages/extension/src/extension.ts` (comando `techdocsEditor.openFromGitHub`, `registerUriHandler`), `packages/extension/src/docsTreeView.ts` (botão "Abrir documentação do GitHub…" na tela sem docs), a lista de repositórios (reaproveitar `findRemoteSites` + a listagem de `remoteRepos.ts`, movidas para `clone/repoList.ts`)
- Test: `packages/extension/src/clone/knownClones.test.ts`, `packages/extension/test/vscode/suite/send.ts`

**Interfaces:**
- Produces:
  ```ts
  export class KnownClones {               // globalState 'techdocsEditor.clones': Record<slug, fsPath>
    constructor(state: vscode.Memento);
    find(host: string, slug: string): Promise<vscode.Uri | undefined>;  // confere que existe e o origin bate
    remember(host: string, slug: string, folder: vscode.Uri): Promise<void>;
  }
  export async function openFromGitHub(opts?: { host?: string; slug?: string; page?: string }): Promise<void>;
  export function suggestedFolder(setting: string, repo: string, home: string): string; // '~/Documents/TechDocs' + repo, '~' expandido
  ```
  Ao abrir a pasta clonada (troca de janela), a página do link vai em `globalState` `techdocsEditor.pendingOpen` e é aberta na ativação.

- [ ] **Step 1: Testes que falham:** `suggestedFolder('~/Documents/TechDocs', 'guia-pagamentos', '/home/m')` → `/home/m/Documents/TechDocs/guia-pagamentos`; `KnownClones.find` ignora caminho apagado; vscode: o link `vscode://edtroleis.techdocs-editor/open?host=github.com&repo=acme/guia&path=docs/a.md` com o clone conhecido abre `docs/a.md` sem clonar; sem Git (`gitApi()` undefined) mostra o aviso com o link de instalação.
- [ ] **Step 2:** `timeout 120 npx vitest run packages/extension/src/clone` e `timeout 300 npm run test:vscode -- --grep "Clonar|link"` → FAIL.
- [ ] **Step 3: Implementar** (validação dos parâmetros do link como B3 hoje).
- [ ] **Step 4:** os dois comandos → PASS.
- [ ] **Step 5: Commit** `feat(enviar): Abrir documentação do GitHub clona num diretório sugerido; o link do Backstage abre a cópia`.

### Task 9: Sai o modo remoto e o painel por página

**Files:**
- Delete: `packages/extension/src/remote/` (exceto o que a Task 8 moveu), `publish/remoteGit.ts(+test)`, `publish/publishPanel.ts`, `publish/strip.ts(+test)`, `publish/localPublisher.ts(+test)` (o que o `Sender` ainda usar já foi movido na Task 4), `mineView.ts`, `webview/panel.ts`, `webview/conflict.ts`, `test/vscode/suite/remote.ts`, `test/vscode/suite/publish.ts`; no `core`: `remoteSession.ts`, `remoteDraft.ts`, `remoteTree.ts`, `myDrafts.ts` (+ testes), e de `remoteLink.ts` fica só o parse do link de B1.
- Modify: `packages/extension/src/extension.ts`, `packages/extension/package.json` (comandos, views, menus, `activationEvents`, `capabilities.virtualWorkspaces: false`; configurações: saem `mode`, `local.publishPanel`, `drafts.skipCi`; entram `send.target`, `clone.directory`; `branchPattern` com o padrão novo), `package.nls*.json`, `l10n/`
- Modify: `specs/02-modos-e-publicacao.md` (M1–M9, LC5 e Publicação apontam para a spec 09), `README.md`, `README.pt-BR.md`, `CHANGELOG.md` (`Unreleased`: Added Clonar/Enviar/Criar o repositório; Removed modo remoto, painel por página, Histórico da página, Minhas alterações, as três configurações)

**Interfaces:** nenhuma nova. `branchPattern` com `{path}` → aviso no canal "TechDocs Editor" e usa o padrão.

- [ ] **Step 1:** `grep -rn "remote/\|publishPanel\|RemoteGit\|techdocs:\|mineView\|pageHistory" packages/*/src packages/extension/package.json` lista o que apagar.
- [ ] **Step 2:** apagar e ajustar; `timeout 120 npm run typecheck && timeout 120 npm run test:unit` → PASS.
- [ ] **Step 3:** `timeout 300 npm run test:vscode` → PASS (só a suíte vscode: é ela que pega comando/configuração órfãos).
- [ ] **Step 4: Commit** `refactor: sai o modo remoto e o painel de publicação por página (spec 09)`.

### Task 10: Cenários de usuário e versão de teste

**Files:**
- Modify: `packages/extension/e2e/scenarios/02-github-vazio.spec.ts` (criar a doc → Enviar cria o repositório; o repo de teste `techdocs-cenario-vazio` já existe, então o cenário usa o caminho "já ligado a um repositório vazio"), `04-github-mkdocs.spec.ts` (Clonar pela tela A/B → editar 2 páginas → Enviar (2) → PR com as 2 → merge pelo `gh` → painel "Aprovado e na branch principal" e a cópia na `main`), `ui.ts` (sai `publishStrip`, entram `sendButton`, `sendPanel`, `sendView`)
- Create: `packages/extension/e2e/scenarios/11-desistir.spec.ts` (envia, desiste, as bolinhas voltam, envia de novo)

- [ ] **Step 1:** `HEADLESS=1 FAST=1 SCENARIOS_LIMIT_MIN=15 timeout 1200 npm run test:scenarios -- 02 04 11` → PASS; conferir os prints do relatório (`node_modules/.cache/scenarios/report.html`): nenhum texto com "branch"/"commit"/"PR" na tela de envio e no painel.
- [ ] **Step 2: Commit** `test(cenarios): clonar, enviar, desistir e criar o repositório`.
- [ ] **Step 3: Versão de teste:** `packages/extension/package.json` com `0.18.99` só no `.vsix` (sem commit), `npm run package`, instalar no VS Code do usuário (`code --install-extension …vsix --force` pelo Windows), e **parar** para o usuário testar. Depois do ok: `test:all`, `chore(release): 0.19.0`, merge na main, push; a tag é do usuário.
