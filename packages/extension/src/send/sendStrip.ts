import type { Strip } from '../publish/strip';
import type { SendState } from './sender';

type T = (message: string, ...args: Array<string | number>) => string;

/**
 * A faixa no topo da página do editor visual (e o item da barra de status) com o envio do repositório: o botão
 * Enviar (N) e, depois de enviar, em que pé está (spec 09, telas 1, 4, 9 e 10). Sem termos do Git.
 */
export function sendStrip(state: SendState | undefined, count: number, l10n: { t: T }): Strip | undefined {
  const details = [{ action: 'details' as const, label: l10n.t('Send details') }];
  const send = (label: string) => ({ action: 'send' as const, label, primary: true });
  if (!state || state.status === 'idle') {
    if (!count) return undefined;
    return {
      tone: 'draft',
      state: count === 1 ? l10n.t('1 change to send') : l10n.t('{0} changes to send', count),
      message: '',
      actions: [send(l10n.t('Send ({0})', count))],
      menu: [],
    };
  }
  switch (state.status) {
    case 'sending':
      return { tone: 'draft', state: l10n.t('Sending…'), message: '', actions: [], menu: details };
    case 'inReview': {
      const failed = state.checks.items.some(c => c.state === 'failed');
      const again = state.pending ? [send(l10n.t('Send again ({0})', state.pending))] : [];
      if (failed)
        return { tone: 'problem', state: l10n.t('Fix and send again'), message: l10n.t('The check found a problem.'), actions: [...again, { action: 'details', label: l10n.t('See what') }], menu: [] };
      if (state.review === 'changesRequested')
        return { tone: 'problem', state: l10n.t('Changes requested'), message: l10n.t('{0} asked for changes.', state.reviewer ?? ''), actions: [...again, { action: 'openPr', label: l10n.t('See on GitHub') }], menu: details };
      return {
        tone: 'review',
        state: state.review === 'approved' ? l10n.t('Approved') : l10n.t('In review'),
        message: state.pending ? (state.pending === 1 ? l10n.t('1 page with a new change.') : l10n.t('{0} pages with a new change.', state.pending)) : '',
        actions: again,
        menu: details,
        url: state.pr.url,
      };
    }
    case 'merged':
      return count
        ? { tone: 'draft', state: l10n.t('{0} changes to send', count), message: '', actions: [send(l10n.t('Send ({0})', count))], menu: [] }
        : { tone: 'done', state: l10n.t('In the documentation'), message: l10n.t('Your changes were approved and are in the main branch.'), actions: [], menu: [] };
    case 'conflict':
      return { tone: 'problem', state: l10n.t('Two versions'), message: l10n.t('The same part changed on GitHub and here: choose what stays.'), actions: [{ action: 'resolve', label: l10n.t('Choose'), primary: true }], menu: [] };
    case 'offline':
      return { tone: 'draft', state: l10n.t('Waiting for the internet'), message: l10n.t('Your changes are saved on this computer. They are sent when the connection is back.'), actions: [], menu: details };
    case 'cannotWrite':
      return { tone: 'problem', state: l10n.t('You cannot send'), message: l10n.t('Your GitHub account can only read this repository.'), actions: [], menu: details };
    case 'error':
      return { tone: 'problem', state: l10n.t('Not sent'), message: state.message, actions: [send(l10n.t('Try again'))], menu: details };
  }
}
