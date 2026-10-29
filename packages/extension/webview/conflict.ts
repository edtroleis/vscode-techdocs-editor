// Webview da resolução de conflito: mostra os trechos e devolve a escolha de cada um. Quem junta o texto e
// grava é o host.
import type { ConflictChoice, MergeChunk } from '@edtroleis/techdocs-editor-core';
import type { ConflictLabels, ConflictMessage } from '../src/remote/conflictPanel';

declare function acquireVsCodeApi(): { postMessage(message: ConflictMessage): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const format = (text: string, ...args: Array<string | number>) => text.replace(/\{(\d+)\}/g, (_, i) => escape(String(args[Number(i)])));

/** Até quantas linhas antes do trecho mostrar, para a pessoa achar o ponto no texto. */
const CONTEXT_LINES = 2;

let chunks: MergeChunk[] = [];
let l: ConflictLabels;
let choices: (ConflictChoice | undefined)[] = [];

function version(title: string, lines: string[], chosen: boolean) {
  const text = lines.join('\n').trim();
  return `<div class="version${chosen ? ' chosen' : ''}"><h3>${escape(title)}</h3>${text ? escape(text) : `<span class="empty">${escape(l.removed)}</span>`}</div>`;
}

function render() {
  const total = choices.length;
  const missing = choices.filter(c => !c).length;
  let n = -1;
  const passages = chunks.map((chunk, i) => {
    if (chunk.kind === 'same') return '';
    const index = ++n;
    const previous = chunks[i - 1];
    const context = previous?.kind === 'same' ? previous.lines.slice(-CONTEXT_LINES).join('\n').trim() : '';
    const choice = choices[index];
    const button = (value: ConflictChoice, label: string) =>
      `<button data-index="${index}" data-choice="${value}" aria-pressed="${choice === value}">${escape(label)}</button>`;
    return `<section class="passage" aria-label="${format(l.passage, index + 1, total)}">
      <h2>${format(l.passage, index + 1, total)}</h2>
      ${context ? `<div class="context">…${escape(context)}</div>` : ''}
      <div class="versions">${version(l.other, chunk.theirs, choice === 'theirs' || choice === 'both')}${version(l.mine, chunk.mine, choice === 'mine' || choice === 'both')}</div>
      <div class="choices" role="group">${button('theirs', l.keepTheirs)}${button('mine', l.keepMine)}${button('both', l.keepBoth)}</div>
    </section>`;
  });
  root.innerHTML = `<h1>${escape(l.title)}</h1><p class="muted">${escape(total ? l.intro : l.nothing)}</p>${passages.join('')}
    <div class="footer"><button class="primary" id="finish"${missing ? ' disabled' : ''}>${escape(l.finish)}</button><button id="cancel">${escape(l.cancel)}</button>
    ${missing ? `<span class="muted" role="status">${format(l.missing, missing)}</span>` : ''}</div>`;
}

root.addEventListener('click', e => {
  const button = (e.target as HTMLElement).closest('button');
  if (!button) return;
  if (button.id === 'finish') return vscode.postMessage({ type: 'done', choices: choices as ConflictChoice[] });
  if (button.id === 'cancel') return vscode.postMessage({ type: 'cancel' });
  const index = Number(button.dataset.index);
  choices[index] = button.dataset.choice as ConflictChoice;
  render();
  root.querySelector<HTMLElement>(`[data-index="${index}"][data-choice="${button.dataset.choice}"]`)?.focus();
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { type: 'init'; chunks: MergeChunk[]; labels: ConflictLabels; total: number };
  if (message.type !== 'init') return;
  chunks = message.chunks;
  l = message.labels;
  choices = Array(message.total).fill(undefined);
  render();
});

vscode.postMessage({ type: 'ready' });
