// Webview do painel "Publicação": só desenha o estado que o host manda e devolve os cliques. Token,
// Git e GitHub ficam no host (A-6).
import type { PanelLabels, PanelMessage, PanelState } from '../src/publish/publishPanel';

declare function acquireVsCodeApi(): { postMessage(message: PanelMessage): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const format = (text: string, ...args: Array<string | number>) => text.replace(/\{(\d+)\}/g, (_, i) => escape(String(args[Number(i)])));

function render(state: PanelState, l: PanelLabels): string {
  switch (state.status) {
    case 'off':
      return '';
    case 'noPage':
      return `<p class="muted">${escape(l.noPage)}</p>`;
    case 'noGit':
      return `<p class="muted">${escape(l.noGit)}</p>`;
    case 'noRemote':
      return `<p class="muted">${escape(l.noRemote)}</p>`;
    case 'loading':
      return `<p class="muted">${escape(l.loading)}</p>`;
    case 'error':
      return `<p class="error" role="alert">${escape(state.message)}</p>`;
    case 'signIn':
      return `<p>${escape(l.signInHint)}</p><div class="actions"><button data-action="signIn">${escape(l.signIn)}</button></div>`;
    case 'ready':
      break;
  }
  const v = state.view;
  const parts: string[] = [];
  parts.push(
    v.onDefaultBranch
      ? `<p class="muted">${format(l.newBranch, v.branch, v.defaultBranch)}</p>`
      : `<p>${escape(l.branch)}: <span class="branch">${escape(v.branch)}</span></p>`,
  );
  if (v.pr) {
    parts.push(
      `<p><a data-url="${escape(v.pr.url)}" href="#">${format(l.pullRequest, v.pr.number)}</a> <span class="muted">(${escape(v.pr.draft ? l.draftPr : l.readyPr)})</span></p>`,
    );
  }
  const disabled = v.busy ? ' disabled' : '';
  const canSend = Boolean(v.pr?.draft) && !v.unverified && !v.conflict;
  parts.push(`<div class="actions">
    <button class="secondary" data-action="saveDraft" title="${escape(l.saveDraftHint)}"${disabled}>${escape(l.saveDraft)}</button>
    <button data-action="saveAndVerify" title="${escape(l.saveAndVerifyHint)}"${disabled}>${escape(l.saveAndVerify)}</button>
    <button data-action="send" title="${escape(l.sendHint)}"${canSend && !v.busy ? '' : ' disabled'}>${escape(v.sendForReview ? l.sendForReview : l.sendForPublication)}</button>
    ${v.pr || !v.onDefaultBranch ? `<button class="secondary" data-action="discard"${disabled}>${escape(l.discard)}</button>` : ''}
  </div>`);
  if (v.published) {
    parts.push(`<p class="notice" role="status"><a data-url="${escape(v.published.url)}" href="#">${format(l.published, v.published.number)}</a></p>`);
  }
  if (v.conflict) {
    parts.push(`<p class="error" role="alert">${escape(l.conflict)}</p>
    <div class="actions"><button data-action="resolve"${disabled}>${escape(l.resolve)}</button></div>`);
  }
  if (v.error) parts.push(`<p class="error" role="alert">${escape(v.error)}</p>`);
  if (v.notice) parts.push(`<p class="notice" role="status">${escape(v.notice)}</p>`);
  if (v.unverified && v.pr) parts.push(`<p class="muted">${escape(l.unverified)}</p>`);
  if (v.pr && v.pr.draft !== undefined) parts.push(renderChecks(v, l));
  if (v.setup?.steps.length) parts.push(renderSetup(v.setup.steps, l, v.busy));
  return parts.join('\n');
}

function renderSetup(steps: string[], l: PanelLabels, busy: boolean): string {
  const names: Record<string, string> = {
    workflow: l.setupWorkflow,
    markdownlint: l.setupMarkdownlint,
    merge: l.setupMerge,
    ruleset: l.setupRuleset,
  };
  return `<h3>${escape(l.setupTitle)}</h3>
    <p>${escape(l.setupMissing)}</p>
    <ul>${steps.map(step => `<li>• ${escape(names[step] ?? step)}</li>`).join('')}</ul>
    <div class="actions"><button class="secondary" data-action="setUp"${busy ? ' disabled' : ''}>${escape(l.setupButton)}</button></div>`;
}

function renderChecks(v: Extract<PanelState, { status: 'ready' }>['view'], l: PanelLabels): string {
  if (!v.pipeline) return `<p class="muted">${escape(l.editorChecks)}</p>`;
  const { summary, items, stalled, pollError } = v.checks;
  const headline = {
    none: stalled ? l.stalled : l.checksNone,
    running: l.checksRunning,
    passed: l.checksPassed,
    failed: l.checksFailed,
  }[summary];
  const list = items
    .map(item => {
      const icon = { passed: '✓', failed: '✗', running: '…' }[item.state];
      const annotations = item.annotations
        .map(
          a =>
            `<li class="annotation"><a data-path="${escape(a.path)}" data-line="${a.line}" href="#">${format(l.line, a.line)}</a>: ${escape(a.text)}${
              a.snippet ? ` <span class="muted">“${escape(a.snippet)}”</span>` : ''
            }</li>`,
        )
        .join('');
      return `<li><span class="check-${item.state}" aria-hidden="true">${icon}</span> ${escape(item.name)} <a data-url="${escape(item.url)}" href="#">${escape(l.details)}</a>${
        item.help && item.state === 'failed' ? `<p class="muted">${escape(item.help)}</p>` : ''
      }${annotations ? `<ul>${annotations}</ul>` : ''}</li>`;
    })
    .join('');
  return `<h3>${escape(l.checks)}</h3>
    <p role="status">${escape(headline)} <a data-action="refresh" href="#">${escape(l.refresh)}</a></p>
    ${pollError ? `<p class="error">${escape(pollError)}</p>` : ''}
    <ul>${list}</ul>`;
}

root.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-url], [data-line]');
  if (!target) return;
  event.preventDefault();
  if (target.dataset.action) {
    vscode.postMessage({ type: 'action', action: target.dataset.action as never });
  } else if (target.dataset.url) {
    vscode.postMessage({ type: 'openUrl', url: target.dataset.url });
  } else if (target.dataset.line) {
    vscode.postMessage({ type: 'showLine', path: target.dataset.path!, line: Number(target.dataset.line) });
  }
});

window.addEventListener('message', event => {
  const message = event.data as { type: 'state'; state: PanelState; labels: PanelLabels };
  if (message.type !== 'state') return;
  // O foco do teclado fica no mesmo botão depois de redesenhar
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;
  root.innerHTML = render(message.state, message.labels);
  if (focused) root.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
});

vscode.postMessage({ type: 'ready' });
