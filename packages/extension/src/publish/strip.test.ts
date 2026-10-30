import { describe, expect, it } from 'vitest';
import type { PublishView } from './localPublisher';
import { stripFor } from './strip';

const t = (message: string, ...args: Array<string | number>) => args.reduce<string>((text, arg, i) => text.replace(`{${i}}`, String(arg)), message);

const view = (over: Partial<PublishView> = {}): PublishView => ({
  page: 'docs/index.md',
  branch: 'main',
  onDefaultBranch: true,
  defaultBranch: 'main',
  othersPrs: [],
  ownPrs: [],
  unverified: false,
  busy: false,
  sendForReview: true,
  ownBranch: true,
  pipeline: true,
  checks: { summary: 'none', items: [], stalled: false },
  ...over,
});
const strip = (over: Partial<PublishView> = {}, remote = true) => stripFor({ status: 'ready', view: view(over) }, { t }, remote);

describe('faixa de estado da página', () => {
  it('sem página nem login: nada, ou o convite para entrar', () => {
    expect(stripFor({ status: 'loading' }, { t }, true)).toBeUndefined();
    expect(stripFor({ status: 'signIn', host: 'github.com' }, { t }, true)?.actions[0]?.action).toBe('signIn');
  });

  it('publicada, rascunho e em revisão', () => {
    expect(strip()).toMatchObject({ tone: 'done', state: 'Published', actions: [] });
    expect(strip({}, false)?.actions).toEqual([{ action: 'submit', label: 'Send for review' }]);
    const draft = strip({ onDefaultBranch: false, branch: 'docs/ana/index' })!;
    expect(draft).toMatchObject({ tone: 'draft', state: 'Draft', actions: [{ action: 'submit', primary: true }] });
    expect(draft.menu.map(m => m.action)).toEqual(['check', 'discard', 'history', 'details']);
    expect(strip({ onDefaultBranch: false, pr: { number: 3, url: 'u', draft: false } })).toMatchObject({ tone: 'review', url: 'u' });
    // Merge feito, ainda na branch do rascunho (clone): publicada
    expect(strip({ onDefaultBranch: false, branch: 'docs/ana/index', published: { number: 3, url: 'u' } }, false)).toMatchObject({ tone: 'done', state: 'Published', url: 'u' });
  });

  it('enviando: os passos com o atual', () => {
    const steps = strip({ onDefaultBranch: false, submitting: 'checking' })!.steps!;
    expect(steps.map(s => s.status)).toEqual(['done', 'now', 'todo']);
  });

  it('verificação falhou: a primeira linha a corrigir', () => {
    const failed = strip({
      onDefaultBranch: false,
      pr: { number: 3, url: 'u', draft: true },
      checks: {
        summary: 'failed',
        stalled: false,
        items: [{ name: 'lint', state: 'failed', url: '', annotations: [{ path: 'docs/index.md', line: 9, text: 'link quebrado' }] }],
      },
    })!;
    expect(failed).toMatchObject({ tone: 'problem', state: '1 thing to fix', message: 'Line 9: link quebrado', line: { line: 9 } });
    expect(failed.actions.map(a => a.action)).toEqual(['showLine', 'submit']);
  });

  it('conflito tem prioridade', () => {
    expect(strip({ onDefaultBranch: false, conflict: true })?.actions[0]?.action).toBe('resolve');
  });
});
