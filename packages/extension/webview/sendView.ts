// Webview do painel Envio (spec 09, telas 4, 9, 10 e 14): só desenha o estado que o host manda e devolve os cliques.
import type { SendState } from '../src/send/sender';
import type { SendViewLabels, SendViewMessage } from '../src/send/sendView';

declare function acquireVsCodeApi(): { postMessage(message: SendViewMessage): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const format = (text: string, ...args: Array<string | number>) => escape(text).replace(/\{(\d+)\}/g, (_, i) => escape(String(args[Number(i)])));
const button = (action: string, label: string, secondary = false) =>
  `<button${secondary ? ' class="secondary"' : ''} data-action="${action}">${escape(label)}</button>`;
const step = (icon: 'done' | 'now' | 'todo' | 'failed', html: string) =>
  `<li class="step"><span class="${icon === 'done' ? 'check-passed' : icon === 'failed' ? 'check-failed' : 'check-running'}" aria-hidden="true">${
    { done: '✓', now: '…', todo: '·', failed: '×' }[icon]
  }</span><span>${html}</span></li>`;

function render(state: SendState | undefined, count: number, l: SendViewLabels): string {
  if (!state || state.status === 'idle') {
    return count
      ? `<p>${format(l.toSend, count)}</p><div class="actions">${button('send', l.send)}</div>`
      : `<p class="muted">${escape(l.nothing)}</p>`;
  }
  switch (state.status) {
    case 'sending':
      return `<p>${escape(l.sending)}</p>`;
    case 'inReview': {
      const failed = state.checks.items.filter(c => c.state === 'failed');
      const running = state.checks.items.some(c => c.state === 'running') || (!state.checks.items.length && !state.checks.stalled);
      const problems = failed
        .flatMap(c => (c.annotations.length ? c.annotations : [{ path: '', line: 0, text: c.help ?? c.name }]))
        .map(
          a =>
            `<li>${escape(a.text)}${
              a.path ? ` <span class="path">${escape(a.path)}:${a.line}</span> <a href="#" data-path="${escape(a.path)}" data-line="${a.line}">${escape(l.seeLine)}</a>` : ''
            }</li>`,
        )
        .join('');
      const checks = failed.length
        ? step('failed', `<strong>${escape(l.checkFailed)}</strong><ul>${problems}</ul>`)
        : step(running ? 'now' : 'done', escape(running ? l.checking : l.checked));
      const review =
        state.review === 'approved'
          ? step('done', format(l.approved, state.reviewer ?? ''))
          : state.review === 'changesRequested'
            ? step('failed', format(l.changesRequested, state.reviewer ?? ''))
            : step(
                'now',
                `${escape(l.waitingReview)}${state.requiredApprovals ? ` <span class="muted">${format(l.waitingApprovals, state.requiredApprovals)}</span>` : ''}`,
              );
      const pending = state.pending
        ? `<p class="info">${state.pending === 1 ? escape(l.pendingOne) : format(l.pendingMany, state.pending)}</p><div class="actions">${button('send', l.sendAgain)}</div>`
        : '';
      return `<p><strong>${escape(state.title)}</strong></p>
        <ul>${step('done', `${escape(l.sent)} · <a href="#" data-url="${escape(state.pr.url)}">${escape(l.seeOnGitHub)}</a>`)}${checks}${review}${step('todo', escape(l.inDocs))}</ul>
        ${pending}
        <div class="actions">${button('continue', l.continueEditing, true)}${button('giveUp', l.giveUp, true)}</div>`;
    }
    case 'merged':
      return `<p><span class="ok" aria-hidden="true">✓</span> <strong>${state.by ? format(l.mergedBy, state.by) : escape(l.merged)}</strong></p>
        <p class="muted">${escape(l.mergedHint)}</p>${count ? `<div class="actions">${button('send', `${l.send} (${count})`)}</div>` : ''}`;
    case 'conflict':
      return `<p class="error" role="alert">${escape(l.conflict)}</p><p class="muted">${escape(l.conflictHint)}</p>
        <ul>${state.paths.map(p => `<li class="path">${escape(p)}</li>`).join('')}</ul><div class="actions">${button('resolve', l.choose)}</div>`;
    case 'offline':
      return `<p><strong>${escape(l.offline)}</strong></p><p class="muted">${escape(l.offlineHint)}</p>`;
    case 'cannotWrite':
      return `<p class="error" role="alert">${escape(l.cannotWrite)}</p><p class="muted">${escape(l.cannotWriteHint)}</p><div class="actions">${button('resolve', l.copyLink, true)}</div>`;
    case 'error':
      return `<p class="error" role="alert">${escape(l.error)}: ${escape(state.message)}</p><div class="actions">${button('send', l.tryAgain)}</div>`;
  }
}

root.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-url], [data-line]');
  if (!target) return;
  event.preventDefault();
  const { action, url, path, line } = target.dataset;
  if (action) vscode.postMessage({ type: 'action', action: action as never });
  else if (url) vscode.postMessage({ type: 'openUrl', url });
  else if (path) vscode.postMessage({ type: 'showLine', path, line: Number(line) });
});

window.addEventListener('message', event => {
  const message = event.data as { type: 'state'; state: SendState | undefined; count: number; labels: SendViewLabels };
  if (message.type !== 'state') return;
  root.innerHTML = render(message.state, message.count, message.labels);
});

vscode.postMessage({ type: 'ready' });
