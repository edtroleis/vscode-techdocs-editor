import type { PanelState } from './publishPanel';

/** Ações da faixa de estado (e do item da barra de status). */
export type StripAction = 'submit' | 'check' | 'discard' | 'history' | 'details' | 'showLine' | 'openPr' | 'signIn' | 'resolve';

/**
 * Faixa no topo da página (editor visual) e na barra de status (editor de texto): em que pé está a página
 * e a próxima ação, nas palavras de quem não conhece Git. O painel "Detalhes da publicação" continua com tudo.
 */
export type Strip = {
  tone: 'done' | 'draft' | 'review' | 'problem';
  /** O estado em poucas palavras ("Rascunho", "Em revisão"). */
  state: string;
  message: string;
  /** Envio em andamento: os passos, com o atual. */
  steps?: Array<{ label: string; status: 'done' | 'now' | 'todo' }>;
  actions: Array<{ action: StripAction; label: string; primary?: boolean }>;
  /** O menu "⋯": ações menos usadas. */
  menu: Array<{ action: StripAction; label: string }>;
  /** O ponto a corrigir (`showLine`). */
  line?: { path: string; line: number };
  /** O pedido de revisão (`openPr`). */
  url?: string;
};

type T = (message: string, ...args: Array<string | number>) => string;

/** O estado do painel na faixa; undefined quando não há o que mostrar (sem página, carregando). */
export function stripFor(state: PanelState, l10n: { t: T }, remote: boolean): Strip | undefined {
  if (state.status === 'signIn') {
    return {
      tone: 'done',
      state: l10n.t('Published version'),
      message: l10n.t('Sign in to GitHub to edit this page and send your changes for review.'),
      actions: [{ action: 'signIn', label: l10n.t('Sign in to GitHub'), primary: true }],
      menu: [],
    };
  }
  if (state.status !== 'ready') return undefined;
  const v = state.view;
  const send = v.sendForReview ? l10n.t('Send for review') : l10n.t('Send for publication');
  const menu: Strip['menu'] = [
    { action: 'check', label: l10n.t('Only check') },
    ...(v.ownBranch && !v.onDefaultBranch ? [{ action: 'discard' as const, label: l10n.t('Discard draft') }] : []),
    ...(remote ? [{ action: 'history' as const, label: l10n.t('Page history') }] : []),
    { action: 'details', label: l10n.t('Publishing details') },
  ];
  const details: Strip['menu'] = [...(remote ? [{ action: 'history' as const, label: l10n.t('Page history') }] : []), { action: 'details', label: l10n.t('Publishing details') }];

  if (v.submitting) {
    const order = ['saving', 'checking', 'sending'] as const;
    const at = order.indexOf(v.submitting);
    const labels = [l10n.t('Fixing the formatting'), l10n.t('Checking'), v.sendForReview ? l10n.t('Asking for review') : l10n.t('Sending for publication')];
    return {
      tone: 'draft',
      state: l10n.t('Sending…'),
      message: '',
      steps: labels.map((label, i) => ({ label, status: i < at ? 'done' : i === at ? 'now' : 'todo' })),
      actions: [],
      menu: details,
    };
  }
  if (v.conflict) {
    return {
      tone: 'problem',
      state: l10n.t('Conflict'),
      message: l10n.t('The published version of this page changed the same passages as your draft.'),
      actions: [{ action: 'resolve', label: l10n.t('Resolve conflict'), primary: true }],
      menu: details,
    };
  }
  const failed = v.checks.items.flatMap(c => (c.state === 'failed' ? c.annotations : []));
  if (v.pr && v.checks.summary === 'failed') {
    const first = failed[0];
    return {
      tone: 'problem',
      state: failed.length > 1 ? l10n.t('{0} things to fix', failed.length) : l10n.t('1 thing to fix'),
      message: first ? l10n.t('Line {0}: {1}', first.line, first.text) : l10n.t('A check failed. See the details of the publication.'),
      actions: [
        ...(first ? [{ action: 'showLine' as const, label: l10n.t('Go to the line'), primary: true }] : []),
        { action: 'submit', label: l10n.t('Send again'), primary: !first },
      ],
      menu,
      line: first && { path: first.path, line: first.line },
    };
  }
  if (v.error) {
    return { tone: 'problem', state: l10n.t('Something went wrong'), message: v.error, actions: [{ action: 'submit', label: l10n.t('Try again'), primary: true }], menu };
  }
  if (v.pr && !v.pr.draft) {
    return {
      tone: 'review',
      state: l10n.t('In review'),
      message: v.sendForReview
        ? l10n.t('Waiting for the review. The page is published when it is approved.')
        : l10n.t('Waiting for the publication on GitHub.'),
      actions: [{ action: 'openPr', label: l10n.t('Open on GitHub') }],
      menu: details,
      url: v.pr.url,
    };
  }
  // Num clone, depois do merge a pessoa continua na branch do rascunho: a página já está publicada
  if (v.pr || (!v.onDefaultBranch && !v.published)) {
    return {
      tone: 'draft',
      state: l10n.t('Draft'),
      message: v.notice ?? l10n.t('Only you see it until you send it.'),
      actions: [{ action: 'submit', label: send, primary: true }],
      menu,
      url: v.pr?.url,
    };
  }
  return {
    tone: 'done',
    state: l10n.t('Published'),
    message: v.published
      ? l10n.t('Your request was approved and the page is published.')
      : remote
        ? l10n.t('Edit at will: saving (Ctrl+S) keeps a draft that only you see.')
        : l10n.t('Edit at will: your changes stay on this computer until you send them.'),
    actions: v.published
      ? [{ action: 'openPr', label: l10n.t('Open on GitHub') }]
      : remote
        ? []
        : [{ action: 'submit', label: send }],
    menu: details,
    url: v.published?.url,
  };
}
