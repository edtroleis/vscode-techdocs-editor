// Webview da tela de envio (spec 09, telas 2, 6 e 15): só desenha o estado que o host manda e devolve os cliques.
// Git e GitHub ficam no host (A-6).
import type { SendItem } from '@edtroleis/techdocs-editor-core';
import type { SendLabels, SendPanelMessage, SendPanelState } from '../src/send/sendPanel';

declare function acquireVsCodeApi(): { postMessage(message: SendPanelMessage): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const format = (text: string, ...args: Array<string | number>) => escape(text).replace(/\{(\d+)\}/g, (_, i) => escape(String(args[Number(i)])));
const plural = (n: number, one: string, many: string) => (n === 1 ? escape(one) : format(many, n));

/** O resumo que a pessoa escreveu fica entre os redesenhos. */
let summary: string | undefined;

function kindOf(item: SendItem, l: SendLabels): [string, string] {
  switch (item.kind) {
    case 'page':
      return item.change === 'modified' ? ['modified', l.kindModified] : item.change === 'added' ? ['added', l.kindAdded] : ['deleted', l.kindDeleted];
    case 'moved':
      return ['moved', l.kindMoved];
    case 'images':
      return ['added', l.kindImages];
    case 'menu':
      return ['modified', l.kindMenu];
    case 'siteFile':
      return ['modified', l.kindSiteFile];
  }
}

function renderItem(item: SendItem, index: number, l: SendLabels, titles: Map<string, string>): string {
  const [css, kind] = kindOf(item, l);
  let name: string;
  let detail: string;
  let link = '';
  switch (item.kind) {
    case 'page':
      name = escape(item.title);
      detail = escape(item.path);
      link =
        item.change === 'modified'
          ? `<a href="#" data-diff="${escape(item.path)}">${escape(l.viewChanges)}</a>`
          : item.change === 'added'
            ? `<a href="#" data-open="${escape(item.path)}">${escape(l.viewPage)}</a>`
            : '';
      break;
    case 'moved':
      name = escape(item.title);
      detail = `${escape(item.from)} → ${escape(item.path)}`;
      break;
    case 'images':
      name = item.usedIn.length
        ? format(l.imagesUsed, item.paths.length, item.usedIn.map(p => titles.get(p) ?? p).join(', '))
        : plural(item.paths.length, l.imagesOne, l.imagesMany);
      detail = '';
      break;
    case 'menu':
      name = escape(l.menu);
      detail = escape(item.path);
      link = `<a href="#" data-diff="${escape(item.path)}">${escape(l.viewChanges)}</a>`;
      break;
    case 'siteFile':
      name = escape(item.path);
      detail = '';
      link = `<a href="#" data-diff="${escape(item.path)}">${escape(l.viewChanges)}</a>`;
      break;
  }
  return `<li class="item"><span class="kind ${css}">${escape(kind)}</span>
    <span class="grow">${name}${detail ? ` <span class="path">${detail}</span>` : ''}</span>
    ${link}<button class="secondary" data-undo="${index}">${escape(l.undo)}</button></li>`;
}

function render(state: SendPanelState, l: SendLabels): string {
  const count = state.groups.reduce((n, g) => n + g.items.length, 0);
  if (!count) return `<p class="muted">${escape(l.nothing)}</p>`;
  const title =
    state.groups.length > 1
      ? format(l.titleSites, count, state.groups.length)
      : count === 1
        ? format(l.titleOne, state.groups[0].site.title)
        : format(l.titleMany, count, state.groups[0].site.title);
  const titles = new Map(state.groups.flatMap(g => g.items.flatMap(i => ('title' in i ? [[i.path, i.title] as const] : []))));
  let index = 0;
  const groups = state.groups
    .map(group => {
      const items = group.items.map(item => renderItem(item, index++, l, titles)).join('');
      return `<p class="group">${escape(group.site.title)} · ${plural(group.items.length, l.changesOne, l.changesMany)}</p><ul>${items}</ul>`;
    })
    .join('');
  const outside = state.outside.length
    ? `<p class="info">${plural(state.outside.length, l.outsideOne, l.outsideMany)}. ${escape(l.outsideHint)} <a href="#" data-action="showOutside">${escape(l.seeWhich)}</a></p>`
    : '';
  const blocking = state.checks.filter(c => c.kind === 'blocking');
  const fixable = state.checks.filter(c => c.kind === 'fixable');
  const checks = state.checks.length
    ? `<ul>${state.checks
        .map(
          c => `<li class="step"><span class="${c.kind}" aria-hidden="true">${c.kind === 'blocking' ? '×' : '!'}</span>
            <span class="grow">${escape(c.text)}</span>${
              c.path && c.kind === 'blocking' ? `<a href="#" data-open="${escape(c.path)}" data-line="${c.line ?? ''}">${escape(l.seeOnPage)}</a>` : ''
            }</li>`,
        )
        .join('')}</ul>${fixable.length ? `<div class="actions"><button class="secondary" data-action="fix">${escape(l.fix)}</button></div>` : ''}`
    : `<p><span class="ok" aria-hidden="true">✓</span> ${escape(l.allGood)}</p>`;
  const disabled = state.busy || blocking.length ? ' disabled' : '';
  return `<h2>${title}</h2>
    <p class="muted">${escape(state.primary === 'publish' ? l.subtitlePublish : l.subtitleReview)}</p>
    <h3>${escape(l.whatGoes)}</h3>${groups}${outside}
    <h3><label for="summary">${escape(l.summary)}</label></h3>
    <textarea id="summary">${escape(summary ?? state.summary)}</textarea>
    <h3>${escape(l.check)}</h3>${checks}
    <div class="actions">
      <button data-action="send"${disabled}>${escape(state.primary === 'publish' ? l.publish : l.sendForReview)}</button>
      <button class="secondary" data-action="cancel">${escape(l.cancel)}</button>
      ${blocking.length ? `<span class="muted">${escape(l.blocked)}</span>` : ''}
    </div>
    ${state.message ? `<p class="error" role="alert">${escape(state.message)}</p>` : ''}`;
}

root.addEventListener('input', event => {
  if ((event.target as HTMLElement).id === 'summary') summary = (event.target as HTMLTextAreaElement).value;
});

root.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-undo], [data-diff], [data-open]');
  if (!target) return;
  event.preventDefault();
  const { action, undo, diff, open, line } = target.dataset;
  if (undo !== undefined) return vscode.postMessage({ type: 'undo', index: Number(undo) });
  if (diff) return vscode.postMessage({ type: 'diff', path: diff });
  if (open) return vscode.postMessage(line ? { type: 'open', path: open, line: Number(line) } : { type: 'open', path: open });
  if (action === 'send') {
    const text = (document.getElementById('summary') as HTMLTextAreaElement | null)?.value.trim();
    return vscode.postMessage({ type: 'send', summary: text || '' });
  }
  if (action === 'fix' || action === 'cancel' || action === 'showOutside') vscode.postMessage({ type: action });
});

window.addEventListener('message', event => {
  const message = event.data as { type: 'state'; state: SendPanelState; labels: SendLabels };
  if (message.type !== 'state') return;
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.action;
  root.innerHTML = render(message.state, message.labels);
  if (focused) root.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
});

vscode.postMessage({ type: 'ready' });
