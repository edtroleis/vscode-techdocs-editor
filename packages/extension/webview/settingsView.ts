// Webview da janela Configurações do TechDocs (0.21): só desenha o estado que o host manda e devolve as escolhas.
import type { SettingsLabels, SettingsMessage, SettingsState } from '../src/settingsView';

declare function acquireVsCodeApi(): { postMessage(message: SettingsMessage): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Uma opção com rádio, a explicação embaixo do nome. */
const radio = (name: string, value: string, checked: boolean, label: string, hint: string) =>
  `<label class="option"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span>${escape(label)}<span class="hint">${escape(hint)}</span></span></label>`;

const checkbox = (key: string, checked: boolean, label: string, hint?: string) =>
  `<label class="option"><input type="checkbox" data-key="${key}"${checked ? ' checked' : ''}><span>${escape(label)}${hint ? `<span class="hint">${escape(hint)}</span>` : ''}</span></label>`;

/** Para o time / Só para mim, no título da parte. */
const scope = (name: string, current: 'team' | 'me', teamPossible: boolean, l: SettingsLabels) =>
  `<span class="scope">${[
    ['team', l.forTeam, l.forTeamHint, !teamPossible],
    ['me', l.justMe, l.justMeHint, false],
  ]
    .map(
      ([value, label, hint, disabled]) =>
        `<button type="button" data-scope="${name}" data-value="${value}" title="${escape(hint as string)}" aria-pressed="${current === value}"${disabled ? ' disabled' : ''}>${escape(label as string)}</button>`,
    )
    .join('')}</span>`;

const group = (id: string, title: string, body: string, extra = '') =>
  `<section role="group" aria-labelledby="h-${id}"><h3><span id="h-${id}">${escape(title)}</span>${extra}</h3>${body}</section>`;

type Attachments = NonNullable<SettingsState['attachments']>;
type AttachmentKey = keyof Attachments['values'];

/** Uma linha de Imagens e anexos: o nome, o campo, e de onde vem o valor (do time, seu; o padrão fica em branco). */
function field(a: Attachments, l: SettingsLabels, group: string, key: AttachmentKey, label: string, kind: 'text' | 'size') {
  const origin = a.from[key] === 'repository' ? l.fromTeam : a.from[key] === 'settings' ? l.fromMe : '';
  const input =
    kind === 'size'
      ? `<input type="number" min="0" step="any" class="size" id="att-${key}" data-attachment="${key}" aria-label="${escape(`${group}: ${label}`)}" value="${escape(a.values[key])}"> MB`
      : `<input type="text" id="att-${key}" data-attachment="${key}" aria-label="${escape(`${group}: ${label}`)}" value="${escape(a.values[key])}" spellcheck="false">`;
  const error = a.error?.key === key ? `<p class="hint error">× ${escape(a.error.text)}</p>` : '';
  return `<div class="row"><span class="name">${escape(label)}</span><span class="line">${input}</span><span class="origin" data-origin="${key}">${escape(origin)}</span></div>${error}`;
}

function attachments(a: Attachments, l: SettingsLabels) {
  const part = (title: string, dir: AttachmentKey, size: AttachmentKey, types: AttachmentKey) =>
    `<h4>${escape(title)}</h4>` +
    field(a, l, title, dir, l.directory, 'text') +
    field(a, l, title, size, l.maxSize, 'size') +
    field(a, l, title, types, l.types, 'text');
  const custom = Object.values(a.from).some(from => from !== 'default');
  return (
    part(l.images, 'images', 'imagesMaxSizeMB', 'imageTypes') +
    part(l.otherFiles, 'files', 'filesMaxSizeMB', 'fileTypes') +
    `<p class="hint">${escape(l.attachmentsHint)}</p>` +
    (custom ? `<p><a href="#" data-reset>${escape(l.backToDefault)}</a></p>` : '')
  );
}

function render(s: SettingsState, l: SettingsLabels): string {
  const parts = [
    group(
      'send',
      l.send,
      radio('sendTarget', 'pullRequest', s.sendTarget === 'pullRequest', l.forReview, l.forReviewHint) +
        radio('sendTarget', 'main', s.sendTarget === 'main', l.straight, l.straightHint),
    ),
    group(
      'copies',
      l.copies,
      `<div class="line"><span class="path box">${escape(s.cloneDirectory)}</span><button type="button" class="secondary" data-clone>${escape(l.change)}</button></div><p class="hint">${escape(l.copiesHint)}</p>`,
    ),
  ];
  if (s.templates) {
    const t = s.templates;
    parts.push(
      group(
        'templates',
        l.templates,
        `<div class="line"><input type="text" id="repository" aria-label="${escape(l.templatesRepository)}" placeholder="acme/techdocs-templates" value="${escape(t.repository)}" spellcheck="false"><button type="button" class="secondary" data-test${t.repository ? '' : ' disabled'}>${escape(l.testAccess)}</button></div>` +
          `<p class="hint">${t.test ? `<span class="${t.test.ok ? 'ok' : 'error'}">${t.test.ok ? '✓' : '×'} ${escape(t.test.text)}</span> · ` : ''}${escape(l.templatesHint)}</p>` +
          checkbox('builtIn', t.builtIn, l.builtIn),
        scope('templates', t.scope, t.teamPossible, l),
      ),
    );
  }
  if (s.catalog) {
    const c = s.catalog;
    parts.push(
      group(
        'catalog',
        'catalog-info.yaml',
        radio('catalogMode', 'auto', c.mode === 'auto', l.catalogAuto, l.catalogAutoHint) +
          radio('catalogMode', 'required', c.mode === 'required', l.catalogRequired, l.catalogRequiredHint) +
          radio('catalogMode', 'off', c.mode === 'off', l.catalogOff, l.catalogOffHint),
        scope('catalog', c.scope, c.teamPossible, l),
      ),
    );
  }
  if (s.attachments) parts.push(group('attachments', l.attachments, attachments(s.attachments, l), scope('attachments', s.attachments.scope, s.attachments.teamPossible, l)));
  parts.push(
    group('editor', l.editor, checkbox('openVisualByDefault', s.openVisual, l.openVisual, l.openVisualHint) + checkbox('syncExplorer', s.syncExplorer, l.syncExplorer)),
    `<p><a href="#" data-all>${escape(l.allSettings)} →</a></p>`,
  );
  return parts.join('');
}

root.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (input.type === 'radio') {
    if (input.name === 'sendTarget') vscode.postMessage({ type: 'sendTarget', value: input.value as 'main' | 'pullRequest' });
    else if (input.name === 'catalogMode') vscode.postMessage({ type: 'catalogMode', value: input.value as never });
  } else if (input.type === 'checkbox') {
    const key = input.dataset.key;
    if (key === 'builtIn') vscode.postMessage({ type: 'templatesBuiltIn', value: input.checked });
    else if (key === 'openVisualByDefault' || key === 'syncExplorer') vscode.postMessage({ type: 'flag', key, value: input.checked });
  } else if (input.id === 'repository') vscode.postMessage({ type: 'templatesRepository', value: input.value });
  else if (input.dataset.attachment) sendAttachment(input);
});

/** Grava o campo (ao sair dele ou com Enter), uma vez por valor. */
function sendAttachment(input: HTMLInputElement) {
  if (input.dataset.sent === input.value) return;
  input.dataset.sent = input.value;
  vscode.postMessage({ type: 'attachment', key: input.dataset.attachment as AttachmentKey, value: input.value });
}

root.addEventListener('keydown', event => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'repository' && event.key === 'Enter') {
    event.preventDefault();
    vscode.postMessage({ type: 'templatesRepository', value: input.value });
  }
  if (input.dataset?.attachment && event.key === 'Enter') {
    event.preventDefault();
    sendAttachment(input);
  }
});

root.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-scope], [data-clone], [data-test], [data-all], [data-reset]');
  if (!target) return;
  event.preventDefault();
  const { scope: name, value } = target.dataset;
  if (name === 'templates') vscode.postMessage({ type: 'templatesScope', value: value as 'team' | 'me' });
  else if (name === 'catalog') vscode.postMessage({ type: 'catalogScope', value: value as 'team' | 'me' });
  else if (name === 'attachments') vscode.postMessage({ type: 'attachmentsScope', value: value as 'team' | 'me' });
  else if ('reset' in target.dataset) vscode.postMessage({ type: 'attachmentsReset' });
  else if ('clone' in target.dataset) vscode.postMessage({ type: 'cloneDirectory' });
  else if ('test' in target.dataset) vscode.postMessage({ type: 'templatesTest' });
  else if ('all' in target.dataset) vscode.postMessage({ type: 'openAll' });
});

window.addEventListener('message', event => {
  const message = event.data as { type: 'state'; state: SettingsState; labels: SettingsLabels };
  if (message.type !== 'state') return;
  // Um estado novo (outra configuração mudou) não apaga o que a pessoa está digitando no repositório
  // (e nos campos de Imagens e anexos: o foco e o que está sendo digitado continuam)
  const typing = document.activeElement instanceof HTMLInputElement && document.activeElement.id ? document.activeElement : undefined;
  const draft = typing && { id: typing.id, value: typing.value, sent: typing.dataset.sent, start: typing.selectionStart, end: typing.selectionEnd };
  const scrollTop = document.scrollingElement?.scrollTop ?? 0;
  root.innerHTML = render(message.state, message.labels);
  if (document.scrollingElement) document.scrollingElement.scrollTop = scrollTop;
  const box = draft && (document.getElementById(draft.id) as HTMLInputElement | null);
  if (draft && box) {
    // O que foi gravado já está no estado novo; o que a pessoa ainda digita, não
    if (draft.sent !== draft.value) box.value = draft.value;
    box.focus();
    try {
      box.setSelectionRange(draft.start, draft.end);
    } catch {
      // campo de número não tem seleção
    }
  }
});

vscode.postMessage({ type: 'ready' });
