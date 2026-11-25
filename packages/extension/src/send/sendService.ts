import {
  isDocsFile,
  itemCount,
  itemPaths,
  nameToTitle,
  parseGitHubRemote,
  sendGroups,
  siteName,
  type SendGroup,
  type SendSite,
} from '@edtroleis/techdocs-editor-core';
import * as vscode from 'vscode';
import type { LocalSites } from '../localSites';
import { clientFor, gitHubErrorText, hasSession } from '../publish/githubAuth';
import type { RepoGit } from '../publish/types';
import { gitApi, type Repository, VscodeGit } from '../publish/vscodeGit';
import type { RepoCheck } from '../repoCheck';
import type { VisualEditorProvider } from '../visualEditorProvider';
import { Sender, type SendState, type SendTarget } from './sender';
import { SendPanel } from './sendPanel';
import { preflight } from './preflight';
import { sendStrip } from './sendStrip';
import { logLine } from '../timing';

/**
 * O envio no VS Code (spec 09): um envio por repositório Git do workspace. Sem login, só conta o que mudou (o Git
 * local basta); o `Sender` (GitHub) nasce no primeiro Enviar, ou ao abrir, se já há login e um envio aberto.
 */

export type RepoSend = {
  git: RepoGit;
  /** Raiz no disco (`uri.path`). */
  root: vscode.Uri;
  sites: SendSite[];
  host?: string;
  slug?: string;
  sender?: Sender;
  state?: SendState;
  groups: SendGroup[];
  count: number;
  /** Arquivo (`uri.toString()`) → 'M' (alterado), 'N' (novo), 'R' (em revisão). */
  marks: Map<string, 'M' | 'N' | 'R'>;
};

const relative = (root: vscode.Uri, path: string) => path.slice(root.path.replace(/\/$/, '').length + 1);
const statusText = (count: number) =>
  count === 1 ? vscode.l10n.t('$(cloud-upload) 1 change to send') : vscode.l10n.t('$(cloud-upload) {0} changes to send', count);

export class SendService implements vscode.Disposable, vscode.FileDecorationProvider {
  private readonly repos = new Map<string, RepoSend>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly decorationEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.decorationEmitter.event;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly statusItem = vscode.window.createStatusBarItem('techdocsEditor.send', vscode.StatusBarAlignment.Left, 48);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshing: Promise<void> | undefined;
  /** Respostas prontas para as perguntas (testes). */
  private answers: ((message: string) => boolean) | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sites: LocalSites,
    private readonly repoCheck: RepoCheck,
    private readonly provider: VisualEditorProvider,
    private readonly setBadge: (count: number) => void,
  ) {
    this.statusItem.command = 'techdocsEditor.send';
    this.statusItem.name = vscode.l10n.t('TechDocs: changes to send');
    this.disposables.push(
      this.statusItem,
      this.decorationEmitter,
      this.changeEmitter,
      vscode.window.registerFileDecorationProvider(this),
      sites.onDidChange(() => this.schedule()),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule()),
      vscode.workspace.onDidCreateFiles(() => this.schedule()),
      vscode.workspace.onDidDeleteFiles(() => this.schedule()),
      vscode.workspace.onDidRenameFiles(() => this.schedule()),
      vscode.window.onDidChangeWindowState(state => this.repos.forEach(r => r.sender?.setFocused(state.focused))),
      vscode.window.onDidChangeActiveTextEditor(() => this.showStatus()),
    );
    this.schedule(0);
  }

  dispose() {
    clearTimeout(this.timer);
    this.repos.forEach(r => r.sender?.dispose());
    this.disposables.forEach(d => d.dispose());
  }

  useTestAnswers(answers: ((message: string) => boolean) | undefined) {
    this.answers = answers;
  }

  /** Os repositórios com documentação, para os testes e para o painel Envio. */
  list(): RepoSend[] {
    return [...this.repos.values()];
  }

  /** O repositório de um arquivo (ou do site mostrado na árvore, ou o único). */
  repoOf(uri?: vscode.Uri): RepoSend | undefined {
    const repos = this.list();
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    return (target && repos.find(r => target.path === r.root.path || target.path.startsWith(`${r.root.path}/`))) ?? (repos.length === 1 ? repos[0] : undefined);
  }

  private schedule(delay = 300) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  /** Relê os repositórios e o que mudou em cada um. */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async load() {
    const api = await gitApi();
    if (!api) return;
    await this.sites.ready;
    const found = new Map<string, { repository: Repository; sites: SendSite[] }>();
    for (const { mkdocs, site } of this.sites.list()) {
      const repository = api.getRepository(mkdocs) ?? (await api.openRepository(vscode.Uri.file(vscode.Uri.parse(site.root).fsPath)).catch(() => null));
      if (!repository) continue;
      const root = repository.rootUri;
      const key = root.toString();
      const entry = found.get(key) ?? { repository, sites: [] };
      const yml = await vscode.workspace.fs.readFile(mkdocs).then(b => new TextDecoder().decode(b), () => undefined);
      const siteRoot = relative(root, site.root);
      entry.sites.push({
        root: site.root === root.path ? '' : siteRoot,
        docsDir: relative(root, site.docsDir),
        mkdocs: relative(root, mkdocs.path),
        title: siteName(yml) ?? nameToTitle(decodeURIComponent(site.root.split('/').pop() ?? '')),
      });
      found.set(key, entry);
    }
    for (const key of [...this.repos.keys()]) if (!found.has(key)) this.repos.get(key)?.sender?.dispose(), this.repos.delete(key);
    for (const [key, { repository, sites }] of found) {
      const existing = this.repos.get(key);
      const git = existing?.git ?? new VscodeGit(repository);
      const remote = git.remoteUrl() ? parseGitHubRemote(git.remoteUrl()!) : undefined;
      const repo: RepoSend = existing ?? { git, root: repository.rootUri, sites, groups: [], count: 0, marks: new Map() };
      repo.sites = sites;
      repo.host = remote?.host;
      repo.slug = remote?.slug;
      this.repos.set(key, repo);
      await this.update(repo);
      // Envio aberto e login já feito: o painel Envio acompanha sem a pessoa pedir
      if (!repo.sender && repo.host && repo.slug && git.currentBranch() !== git.defaultBranch() && (await hasSession(repo.host))) {
        await this.connect(repo).catch(() => undefined);
      }
    }
    this.showStatus();
    this.changeEmitter.fire();
  }

  /** O que mudou no repositório (o `Sender` sabe; sem ele, o Git local). */
  private async update(repo: RepoSend) {
    if (repo.sender) {
      await repo.sender.refresh();
      return;
    }
    await repo.git.refresh();
    const base = repo.git.defaultBranch();
    const changes = base ? await repo.git.diffWith(`origin/${base}`).catch(() => []) : await this.allFiles(repo);
    const texts = await this.texts(repo, changes.map(c => c.path));
    const { groups } = sendGroups(changes, repo.sites, path => texts.get(path));
    this.setItems(repo, groups, undefined);
  }

  /** Sem `origin` (repositório novo): todos os arquivos da documentação são novos. */
  private async allFiles(repo: RepoSend) {
    const files: Array<{ path: string; status: 'added' }> = [];
    for (const site of repo.sites) {
      for (const dir of [site.docsDir]) {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.joinPath(repo.root, dir), '**/*'));
        files.push(...uris.map(u => ({ path: relative(repo.root, u.path), status: 'added' as const })));
      }
      files.push({ path: site.mkdocs, status: 'added' });
    }
    return files.filter(f => isDocsFile(f.path, repo.sites));
  }

  private async texts(repo: RepoSend, paths: string[]) {
    const texts = new Map<string, string>();
    for (const path of paths.filter(p => p.endsWith('.md'))) {
      const uri = vscode.Uri.joinPath(repo.root, path);
      const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      const text = open?.getText() ?? (await vscode.workspace.fs.readFile(uri).then(b => new TextDecoder().decode(b), () => undefined));
      if (text !== undefined) texts.set(path, text);
    }
    return texts;
  }

  private setItems(repo: RepoSend, groups: SendGroup[], state: SendState | undefined) {
    repo.groups = groups;
    repo.count = itemCount(groups);
    repo.state = state;
    const before = [...repo.marks.keys()];
    repo.marks = new Map();
    const inReview = state?.status === 'inReview';
    for (const item of groups.flatMap(g => g.items)) {
      const mark = item.kind === 'page' && item.change === 'added' ? 'N' : 'M';
      for (const path of itemPaths(item)) repo.marks.set(vscode.Uri.joinPath(repo.root, path).toString(), mark);
    }
    if (inReview && repo.count === 0) repo.marks.clear();
    this.decorationEmitter.fire([...new Set([...before, ...repo.marks.keys()])].map(u => vscode.Uri.parse(u)));
    this.showStatus();
    this.changeEmitter.fire();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    for (const repo of this.repos.values()) {
      const mark = repo.marks.get(uri.toString());
      if (!mark) continue;
      return mark === 'N'
        ? new vscode.FileDecoration('N', vscode.l10n.t('New page, not sent yet'), new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'))
        : new vscode.FileDecoration('M', vscode.l10n.t('Changed, not sent yet'), new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }
    return undefined;
  }

  /** A barra de status, o número na árvore e a faixa do editor visual de cada página do repositório. */
  private showStatus() {
    const repo = this.repoOf();
    const total = this.list().reduce((n, r) => n + r.count, 0);
    this.setBadge(total);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.sendCount', total);
    void vscode.commands.executeCommand('setContext', 'techdocsEditor.sendOpen', this.list().some(r => r.state && r.state.status !== 'idle'));
    if (repo?.count) {
      this.statusItem.text = statusText(repo.count);
      this.statusItem.show();
    } else this.statusItem.hide();
    for (const r of this.list()) {
      const strip = sendStrip(r.state, r.count, vscode.l10n);
      for (const document of vscode.workspace.textDocuments) {
        if (document.uri.path.startsWith(`${r.root.path}/`) && isDocsFile(relative(r.root, document.uri.path), r.sites)) this.provider.setStrip(document.uri, strip);
      }
    }
  }

  /** Cria o `Sender` do repositório (pede o login se faltar). */
  private async connect(repo: RepoSend, target?: SendTarget): Promise<Sender> {
    if (repo.sender) return repo.sender;
    const client = clientFor(repo.host!, repo.slug!);
    const config = vscode.workspace.getConfiguration('techdocsEditor');
    const texts = new Map<string, string>();
    const sender = new Sender({
      git: repo.git,
      client,
      sites: () => repo.sites,
      target: target ?? (config.get<SendTarget>('send.target') === 'main' ? 'main' : 'pullRequest'),
      branchPattern: branchPattern(config.get<string>('branchPattern')),
      saveAll: async () => {
        for (const document of vscode.workspace.textDocuments) {
          if (document.isDirty && document.uri.path.startsWith(`${repo.root.path}/`) && isDocsFile(relative(repo.root, document.uri.path), repo.sites)) await document.save();
        }
        const changed = (await repo.git.diffWith(`origin/${repo.git.defaultBranch()}`).catch(() => [])).map(c => c.path);
        const fresh = await this.texts(repo, changed);
        texts.clear();
        fresh.forEach((v, k) => texts.set(k, v));
      },
      pageText: path => texts.get(path),
      l10n: vscode.l10n,
      confirm: (message, action) => this.confirm(message, action),
      onChange: state => {
        this.setItems(repo, state.status === 'idle' ? state.groups : repo.groups, state);
        void SendPanel.current(repo.root.toString())?.stateChanged(state);
      },
      config: {
        language: vscode.env.language,
        checkHelp: config.get<Record<string, string>>('verification.checkHelp') ?? {},
        startTimeoutMs: (config.get<number>('verification.startTimeoutSeconds') ?? 120) * 1000,
        pollMs: (config.get<number>('polling.intervalSeconds') ?? 8) * 1000,
        idlePollMs: (config.get<number>('polling.idleIntervalSeconds') ?? 60) * 1000,
        verificationMode: config.get('verification.mode') ?? 'auto',
      },
    });
    await sender.load();
    repo.sender = sender;
    return sender;
  }

  private async confirm(message: string, action: string) {
    if (this.answers) return this.answers(message);
    return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action;
  }

  /** "Enviar": abre a tela de envio do repositório (spec 09, tela 2). */
  async open(uri?: vscode.Uri): Promise<SendPanel | undefined> {
    await this.refresh();
    let repo = this.repoOf(uri);
    // Diretório sem Git ou repositório sem GitHub: cria o repositório (tela 12); sem nome e e-mail: tela 13
    const site = repo ? undefined : this.sites.list().find(s => (uri ?? vscode.window.activeTextEditor?.document.uri)?.path.startsWith(`${s.site.root}/`)) ?? (this.sites.list().length === 1 ? this.sites.list()[0] : undefined);
    if (!repo && !site) {
      void vscode.window.showInformationMessage(vscode.l10n.t('Open a page of the documentation to send its changes.'));
      return undefined;
    }
    try {
      const ready = await preflight(repo?.git, repo?.root ?? vscode.Uri.file(vscode.Uri.parse(site!.site.root).fsPath));
      if (!ready) return undefined;
      if (!repo || !repo.host) {
        await this.refresh();
        repo = this.list().find(r => r.git.root === ready.git.root) ?? this.repoOf(uri);
        if (!repo) return undefined;
      }
      const sender = await this.connect(repo, ready.firstSend ? 'main' : undefined);
      await sender.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(gitHubErrorText(error, vscode.l10n));
      return undefined;
    }
    const sender = repo.sender!;
    const base = repo.git.defaultBranch() ?? 'main';
    const api = await gitApi();
    return SendPanel.show(this.extensionUri, {
      key: repo.root.toString(),
      sender,
      uri: path => vscode.Uri.joinPath(repo.root, path),
      original: path => api!.toGitUri(vscode.Uri.joinPath(repo.root, path), `origin/${base}`),
      conference: {
        findings: async paths => {
          const all = [];
          for (const site of repo.sites) {
            const check = await this.repoCheck.siteFindings(vscode.Uri.joinPath(repo.root, site.mkdocs));
            all.push(...(check?.findings ?? []).filter(f => paths.includes(f.file) || f.file === site.mkdocs));
          }
          return all;
        },
        fixAll: async findings => this.repoCheck.applyQuietly(findings, repo.root),
      },
    });
  }

  /** O que a faixa e o painel Envio pedem. */
  async action(uri: vscode.Uri, action: string) {
    const repo = this.repoOf(uri);
    const state = repo?.state;
    switch (action) {
      case 'send':
        if (state?.status === 'inReview') return repo!.sender!.send(state.title);
        return this.open(uri);
      case 'openPr':
        if (state?.status === 'inReview') return vscode.env.openExternal(vscode.Uri.parse(state.pr.url));
        return undefined;
      case 'giveUp':
        return repo?.sender?.giveUp();
      case 'resolve':
        if (state?.status === 'conflict') return vscode.window.showTextDocument(vscode.Uri.joinPath(repo!.root, state.paths[0]));
        return undefined;
      default:
        return vscode.commands.executeCommand('techdocsEditor.envio.focus');
    }
  }
}

/** `{path}` era do envio por página (antes da 0.19): ignorado, com aviso no canal "TechDocs Editor". */
export function branchPattern(setting: string | undefined): string {
  const fallback = 'docs/{login}/{date}';
  if (setting?.includes('{path}')) logLine(`techdocsEditor.branchPattern com {path} (do envio por página) ignorado: usado ${fallback}`);
  if (!setting || setting.includes('{path}') || !setting.includes('{login}')) return fallback;
  return setting;
}
