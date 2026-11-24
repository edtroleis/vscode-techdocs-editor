import { GitHubClient, userTransport, type SendSite } from '@edtroleis/techdocs-editor-core';
import { describe, expect, it, vi } from 'vitest';
import { FakeGitHub } from '../../../core/test/fakeGitHub';
import { FakeGit } from '../../test/fakeGit';
import { envioBranch, Sender, type SendState, type SendTarget } from './sender';

const SITES: SendSite[] = [
  { root: '', docsDir: 'docs', mkdocs: 'mkdocs.yml', title: 'Guia' },
  { root: 'api', docsDir: 'api/docs', mkdocs: 'api/mkdocs.yml', title: 'API' },
];
const FILES = {
  'mkdocs.yml': 'site_name: Guia\n',
  'docs/a.md': '# A\n\nTexto.\n',
  'docs/b.md': '# B\n\nTexto.\n',
  'docs/index.md': '# Início\n',
  'api/mkdocs.yml': 'site_name: API\n',
  'api/docs/index.md': '# API\n',
  'src/x.ts': 'export {};\n',
};
const t = (message: string, ...args: Array<string | number>) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
const OFFLINE = new Error('offline');

function setup(opts: { target?: SendTarget; confirm?: boolean } = {}) {
  const github = new FakeGitHub(FILES);
  github.login = 'msilva';
  const git = new FakeGit(github);
  const client = new GitHubClient({ ...userTransport(github.token), fetch: github.fetch }, github.slug);
  const states: SendState[] = [];
  const saveAll = vi.fn(async () => {});
  const confirm = vi.fn(async () => opts.confirm ?? true);
  const sender = new Sender({
    git,
    client,
    sites: () => SITES,
    target: opts.target ?? 'pullRequest',
    branchPattern: 'docs/{login}/{date}',
    saveAll,
    pageText: path => git.work[path],
    l10n: { t },
    confirm,
    onChange: state => states.push(state),
    now: () => new Date(2026, 10, 24, 18, 30),
    isOffline: e => e === OFFLINE,
    config: { language: 'pt-br', checkHelp: {}, startTimeoutMs: 60_000, pollMs: 8_000, idlePollMs: 60_000, verificationMode: 'auto' },
  });
  const state = () => states[states.length - 1];
  return { github, git, client, sender, state, saveAll, confirm };
}

const docsBranches = (github: FakeGitHub) => [...github.refs.keys()].filter(b => b.startsWith('docs/'));

describe('envio do repositório inteiro', () => {
  it('nome da branch do envio', () => {
    expect(envioBranch('docs/{login}/{date}', 'msilva', new Date(2026, 10, 24, 18, 30))).toBe('docs/msilva/20261124-1830');
  });

  it('na principal: salva, cria a branch do envio, leva só a documentação e abre um pedido de revisão pronto', async () => {
    const { github, git, sender, state, saveAll } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    git.work['docs/novo.md'] = '# Novo\n';
    git.work['src/x.ts'] = 'export const x = 1;\n';
    await sender.refresh();
    expect(state()).toMatchObject({ status: 'idle', count: 2, outside: ['src/x.ts'] });
    await sender.send('Atualiza A; cria Novo');
    expect(saveAll).toHaveBeenCalled();
    expect(docsBranches(github)).toEqual(['docs/msilva/20261124-1830']);
    const pr = github.openPull('docs/msilva/20261124-1830')!;
    expect(pr).toMatchObject({ title: 'Atualiza A; cria Novo', draft: false, base: 'main' });
    const sent = github.head('docs/msilva/20261124-1830')!.files;
    expect(sent['docs/a.md']).toBe('# A\n\nNovo.\n');
    expect(sent['docs/novo.md']).toBe('# Novo\n');
    expect(sent['src/x.ts']).toBe('export {};\n');
    expect(git.work['src/x.ts']).toBe('export const x = 1;\n');
    expect(state()).toMatchObject({ status: 'inReview', pr: { number: pr.number }, pending: 0, review: 'waiting' });
  });

  it('numa branch de dev, o envio sai dela', async () => {
    const { github, git, sender } = setup();
    await git.createBranch('feature/x');
    git.work['docs/a.md'] = '# A\n\nDo dev.\n';
    await sender.load();
    await sender.send('Atualiza A');
    expect(docsBranches(github)).toEqual([]);
    expect(github.openPull('feature/x')).toBeDefined();
  });

  it('depois do envio, a mudança nova entra no mesmo pedido de revisão', async () => {
    const { github, git, sender, state } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Atualiza A');
    git.work['docs/b.md'] = '# B\n\nNovo.\n';
    await sender.refresh();
    expect(state()).toMatchObject({ status: 'inReview', pending: 1 });
    await sender.send('Atualiza A e B');
    expect(github.pulls.filter(p => p.state === 'open')).toHaveLength(1);
    expect(github.head('docs/msilva/20261124-1830')!.files['docs/b.md']).toBe('# B\n\nNovo.\n');
    expect(state()).toMatchObject({ status: 'inReview', pending: 0 });
  });

  it('se o pedido de revisão falhou, enviar de novo não cria outra branch nem outro pedido', async () => {
    const { github, git, sender, state } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    github.failNext('POST', /\/pulls$/, 502, 'Bad Gateway');
    await sender.send('Atualiza A');
    expect(state().status).toBe('error');
    await sender.send('Atualiza A');
    expect(docsBranches(github)).toHaveLength(1);
    expect(github.pulls).toHaveLength(1);
    expect(state().status).toBe('inReview');
  });

  it('a principal andou sem sobreposição: junta e envia; com sobreposição: conflito e nada vai', async () => {
    const { github, git, sender, state } = setup();
    await sender.load();
    github.push('main', github.commit('docs: da Ana', { ...FILES, 'docs/b.md': '# B\n\nDa Ana.\n' }));
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Atualiza A');
    expect(state().status).toBe('inReview');
    expect(github.head('docs/msilva/20261124-1830')!.files['docs/b.md']).toBe('# B\n\nDa Ana.\n');

    const other = setup();
    await other.sender.load();
    other.github.push('main', other.github.commit('docs: da Ana', { ...FILES, 'docs/a.md': '# A\n\nDa Ana.\n' }));
    other.git.work['docs/a.md'] = '# A\n\nMeu.\n';
    await other.sender.send('Atualiza A');
    expect(other.state()).toEqual({ status: 'conflict', paths: ['docs/a.md'] });
    expect(docsBranches(other.github)).toEqual([]);
  });

  it('sem permissão de escrita: avisa antes de mexer em qualquer coisa', async () => {
    const { github, git, sender, state } = setup();
    github.canWrite = false;
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Atualiza A');
    expect(state()).toEqual({ status: 'cannotWrite', repoUrl: `https://github.com/${github.slug}` });
    expect(git.current).toBe('main');
    expect(git.branches.size).toBe(1);
  });

  it('direto na principal: commit e push na main, sem pedido de revisão; proteção recusa com aviso', async () => {
    const { github, git, sender, state } = setup({ target: 'main' });
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Atualiza A');
    expect(github.head('main')!.files['docs/a.md']).toBe('# A\n\nNovo.\n');
    expect(github.pulls).toHaveLength(0);
    expect(state().status).toBe('merged');

    const other = setup({ target: 'main' });
    await other.sender.load();
    other.git.rejectPush = () => new Error('remote: error: GH006: Protected branch update failed');
    other.git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await other.sender.send('Atualiza A');
    expect(other.state()).toEqual({ status: 'error', message: 'This repository requires review: send it for review instead.' });
  });

  it('o primeiro envio de um repositório novo vai na principal mesmo com o padrão pedido de revisão', async () => {
    const { github, git, sender } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Primeira versão', { target: 'main' });
    expect(github.head('main')!.files['docs/a.md']).toBe('# A\n\nNovo.\n');
    expect(github.pulls).toHaveLength(0);
  });

  it('Desfazer volta o item ao da principal; cancelado, não mexe; o mesmo nome em outro site fica', async () => {
    const { git, sender, state, confirm } = setup();
    await sender.load();
    git.work['docs/novo.md'] = '# Novo\n';
    git.work['docs/c.md'] = git.work['docs/b.md'];
    delete git.work['docs/b.md'];
    git.work['docs/index.md'] = '# Início novo\n';
    git.work['api/docs/index.md'] = '# API nova\n';
    await sender.refresh();
    const items = () => {
      const s = state();
      return s.status === 'idle' ? s.groups.flatMap(g => g.items) : [];
    };
    const novo = items().find(i => 'path' in i && i.path === 'docs/novo.md')!;
    confirm.mockResolvedValueOnce(false);
    await sender.undo(novo);
    expect(git.work['docs/novo.md']).toBe('# Novo\n');
    await sender.undo(novo);
    expect(git.work['docs/novo.md']).toBeUndefined();
    await sender.undo(items().find(i => i.kind === 'moved')!);
    expect(git.work['docs/b.md']).toBe(FILES['docs/b.md']);
    expect(git.work['docs/c.md']).toBeUndefined();
    await sender.undo(items().find(i => 'path' in i && i.path === 'docs/index.md')!);
    expect(git.work['docs/index.md']).toBe(FILES['docs/index.md']);
    expect(git.work['api/docs/index.md']).toBe('# API nova\n');
  });

  it('Desistir fecha o pedido, apaga a branch e devolve as mudanças à principal, não enviadas', async () => {
    const { github, git, sender, state } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Atualiza A');
    const number = github.openPull()!.number;
    await sender.giveUp();
    expect(github.pulls.find(p => p.number === number)!.state).toBe('closed');
    expect(docsBranches(github)).toEqual([]);
    expect(git.current).toBe('main');
    expect([...git.branches.keys()]).toEqual(['main']);
    expect(git.work['docs/a.md']).toBe('# A\n\nNovo.\n');
    expect(state()).toMatchObject({ status: 'idle', count: 1 });
  });

  it('Desistir com a principal local mudada no mesmo arquivo: não mexe em nada e mostra o conflito', async () => {
    const { github, git, sender, state } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Atualiza A');
    git.branches.set('main', github.commit('local', { ...FILES, 'docs/a.md': '# A\n\nOutro.\n' }));
    await sender.giveUp();
    expect(state()).toEqual({ status: 'conflict', paths: ['docs/a.md'] });
    expect(git.current).toBe('docs/msilva/20261124-1830');
    expect(github.openPull()).toBeDefined();
  });

  it('aprovado e com o merge feito: a cópia volta à principal atualizada e a branch do envio some', async () => {
    const { github, git, sender, state } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    await sender.send('Atualiza A');
    const pr = github.openPull()!;
    github.review(pr.number, 'carla', 'APPROVED');
    await sender.refresh();
    expect(state()).toMatchObject({ status: 'inReview', review: 'approved', reviewer: 'carla' });
    github.mergePull(pr.number);
    await sender.refresh();
    expect(state()).toEqual({ status: 'merged', by: 'carla' });
    expect(git.current).toBe('main');
    expect(git.branches.has('docs/msilva/20261124-1830')).toBe(false);
    expect(git.work['docs/a.md']).toBe('# A\n\nNovo.\n');
    expect(git.changedFiles()).toEqual([]);
  });

  it('sem internet: fica esperando e envia sozinho quando a conexão volta', async () => {
    const { github, git, sender, state } = setup();
    await sender.load();
    git.work['docs/a.md'] = '# A\n\nNovo.\n';
    let down = true;
    git.rejectPush = () => (down ? OFFLINE : undefined);
    await sender.send('Atualiza A');
    expect(state()).toEqual({ status: 'offline', retrying: true });
    down = false;
    await sender.refresh();
    expect(state().status).toBe('inReview');
    expect(github.pulls).toHaveLength(1);
  });
});
