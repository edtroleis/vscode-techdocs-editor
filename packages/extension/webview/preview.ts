// Webview da prévia da documentação nova: desenha o plano que o host manda e devolve o que a pessoa mexeu. O que
// é só da tela (Arquivos ou Menu, a página sendo acrescentada, o título sendo renomeado) fica aqui.
import type { PlanNavEntry, PlanNavPage } from '@edtroleis/techdocs-editor-core';
import type { PreviewLabels, PreviewMessage, PreviewState, PreviewView } from '../src/templates/sitePreview';

declare function acquireVsCodeApi(): { postMessage(message: PreviewMessage): void };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const format = (text: string, ...args: Array<string | number>) => text.replace(/\{(\d+)\}/g, (_, i) => escape(String(args[Number(i)])));

type Adding = { kind: 'page' | 'section'; section?: string; type: string };
const ui: { mode: 'files' | 'menu'; adding?: Adding; renaming?: string; dragging?: string; hint: string } = { mode: 'files', hint: '' };
let state: PreviewState = { status: 'idle' };
let l: PreviewLabels;

const DOCS = 'docs/';

function render() {
  if (state.status !== 'ready') {
    root.innerHTML = '';
    return;
  }
  const v = state.view;
  const focused = document.activeElement as HTMLInputElement | null;
  const focus = focused?.id ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : undefined;
  root.innerHTML = fields(v) + viewbar() + `<div class="tree" role="tree">${ui.mode === 'menu' ? menu(v) : files(v)}</div>` + foot(v);
  if (focus) {
    const element = document.getElementById(focus.id) as HTMLInputElement | null;
    element?.focus();
    if (element && focus.start !== null && 'setSelectionRange' in element && element.type === 'text') element.setSelectionRange(focus.start, focus.end);
  }
  const editing = document.getElementById('rename') as HTMLInputElement | null;
  if (editing && document.activeElement !== editing) {
    editing.focus();
    editing.select();
  }
  const adding = document.getElementById('add') as HTMLInputElement | null;
  if (adding && !focus) adding.focus();
}

function fields(v: PreviewView) {
  const templates = [...(v.allowNone ? [{ id: '', name: l.noTemplate }] : []), ...v.templates];
  const field = (id: string, label: string, value: string, help: string, missing: boolean, optional = false) =>
    `<div class="field"><label for="${id}">${escape(label)}${optional ? ` <span class="from">(${escape(l.optional)})</span>` : ''}</label>
      <input id="${id}" type="text" value="${escape(value)}" class="${missing ? 'missing' : ''}"><span class="from">${help}</span></div>`;
  const ownerHelp = !v.ownerRequired ? escape(l.ownerOptional) : v.owner.trim() && v.ownerFrom ? format(l.suggestedFrom, v.ownerFrom) : v.owner.trim() ? '' : escape(l.notFoundOwner);
  return `<div class="fields">
    <div class="field"><label for="f-template">${escape(l.template)}</label><select id="f-template">${templates
      .map(t => `<option value="${escape(t.id)}"${t.id === v.template ? ' selected' : ''}>${escape(t.name)}</option>`)
      .join('')}</select></div>
    ${field('f-siteName', l.siteName, v.siteName, v.siteName.trim() ? format(l.suggestedFrom, v.siteNameFrom) : '', v.missing.includes('siteName'))}
    ${field('f-owner', l.owner, v.owner, ownerHelp, v.missing.includes('owner'), !v.ownerRequired)}
    ${
      v.readme
        ? `<div class="field"><label for="f-readme">${escape(v.readme.path)}</label><select id="f-readme">${(
            [
              ['copy', l.readmeCopy],
              ['move', l.readmeMove],
              ['skip', l.readmeSkip],
            ] as const
          )
            .map(([id, name]) => `<option value="${id}"${v.readme!.use === id ? ' selected' : ''}>${escape(name)}</option>`)
            .join('')}</select></div>`
        : ''
    }
  </div>`;
}

function viewbar() {
  return `<div class="viewbar"><span class="seg" role="group">
    <button data-mode="files" aria-pressed="${ui.mode === 'files'}">${escape(l.files)}</button><button data-mode="menu" aria-pressed="${ui.mode === 'menu'}">${escape(l.menu)}</button></span>
    <span class="hint">${escape(ui.mode === 'menu' ? l.menuHint : l.filesHint)}</span>
    <button class="link" data-add="page" title="${escape(l.addPageTitle)}" aria-label="${escape(l.addPageTitle)}">+</button></div>`;
}

type FileView = PreviewView['files'][number];

function note(f: FileView) {
  if (f.conflict) return f.conflict.replace ? l.replaced : l.exists;
  if (f.origin === 'readme' && !f.path.startsWith(DOCS)) return f.readme === 'move' ? l.readmeLink : l.readmeStays;
  if (f.readme) return f.readme === 'move' ? l.fromReadmeMove : l.fromReadmeCopy;
  if (f.origin === 'added') return l.addedByYou;
  return '';
}

const badge = (status: string, conflict?: { replace: boolean }) =>
  conflict && !conflict.replace
    ? `<span class="badge c" title="${escape(l.exists)}">!</span>`
    : status === 'new'
      ? `<span class="badge n" title="${escape(l.newFile)}">N</span>`
      : status === 'modified'
        ? `<span class="badge m" title="${escape(l.modifiedFile)}">M</span>`
        : '';

const kindClass = (status: string) => (status === 'new' ? 'new' : status === 'modified' ? 'mod' : '');
const removeButton = (path: string, label: string) => `<button class="x" data-remove="${escape(path)}" title="${escape(l.remove)}" aria-label="${escape(l.remove)} ${escape(label)}">×</button>`;

function checkbox(f: { path: string; optional: boolean; included: boolean; origin: string }, label: string) {
  if (!f.optional) {
    return f.origin === 'mkdocs' ? `<input type="checkbox" checked disabled title="${escape(l.required)}">` : '<span class="spacer"></span>';
  }
  return `<input type="checkbox" data-toggle="${escape(f.path)}"${f.included ? ' checked' : ''} aria-label="${escape(format(l.include, label))}">`;
}

function fileRow(f: FileView, depth: number, v: PreviewView) {
  const name = f.path.split('/').pop()!;
  const icon = /\.ya?ml$/.test(name) ? '{}' : 'M↓';
  let html = `<div class="row ${kindClass(f.status)}${f.included ? '' : ' off'}${v.selected === f.path ? ' sel' : ''}" tabindex="0" role="treeitem" data-open="${escape(f.path)}" style="padding-left:${10 + depth * 14}px">
    ${checkbox(f, name)}<span class="ic">${icon}</span><span class="name">${escape(name)}</span><span class="desc">${escape(note(f))}</span>
    <span class="end">${f.origin === 'added' ? removeButton(f.path.slice(DOCS.length), name) : ''}${badge(f.status, f.conflict)}</span></div>`;
  if (f.conflict) {
    const page = f.path.slice(DOCS.length);
    html += `<div class="conflict" style="padding-left:${46 + depth * 14}px"><button data-replace="${escape(page)}" data-value="false" aria-pressed="${!f.conflict.replace}">${escape(l.keep)}</button><button data-replace="${escape(page)}" data-value="true" aria-pressed="${f.conflict.replace}">${escape(l.replace)}</button></div>`;
  }
  return html;
}

function files(v: PreviewView) {
  type Folder = { dirs: Record<string, Folder>; files: FileView[] };
  const tree: Folder = { dirs: {}, files: [] };
  for (const f of v.files) {
    let node = tree;
    for (const dir of f.path.split('/').slice(0, -1)) node = node.dirs[dir] ??= { dirs: {}, files: [] };
    node.files.push(f);
  }
  const out: string[] = [];
  const walk = (node: Folder, depth: number) => {
    for (const [name, child] of Object.entries(node.dirs).sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`<div class="row" style="padding-left:${10 + depth * 14}px"><span class="spacer"></span><span class="ic dir">▸</span><span class="name">${escape(name)}</span></div>`);
      walk(child, depth + 1);
    }
    for (const f of node.files) out.push(fileRow(f, depth, v));
  };
  walk(tree, 0);
  return out.join('') + addArea(v);
}

function menuRow(p: PlanNavPage, key: string, depth: number, v: PreviewView) {
  const path = DOCS + p.path;
  const file = v.files.find(f => f.path === path);
  const title =
    ui.renaming === key
      ? `<input class="edit" id="rename" type="text" value="${escape(p.title)}" data-key="${escape(key)}">`
      : `<span class="name" data-rename="${escape(key)}" title="${escape(l.rename)}">${escape(p.title)}</span>`;
  const top = depth === 0;
  return `<div class="row ${kindClass(p.status)}${p.included ? '' : ' off'}${v.selected === path ? ' sel' : ''}" tabindex="0" role="treeitem" data-open="${escape(path)}"${top ? ` draggable="true" data-key="${escape(key)}"` : ''} style="padding-left:${8 + depth * 18}px">
    <span class="handle" aria-hidden="true">${top ? '⋮⋮' : ''}</span>${file ? checkbox(file, p.title) : '<span class="spacer"></span>'}${title}<span class="desc">${escape(p.path)}</span>
    <span class="end">${top ? moveButtons(key) : ''}${p.origin === 'added' ? removeButton(p.path, p.title) : ''}</span></div>`;
}

const moveButtons = (key: string, extra = '') =>
  `<span class="move">${extra}<button data-up="${escape(key)}" aria-label="${escape(l.up)}" title="${escape(l.up)}">↑</button><button data-down="${escape(key)}" aria-label="${escape(l.down)}" title="${escape(l.down)}">↓</button></span>`;

function menu(v: PreviewView) {
  return (
    v.nav
      .map((e: PlanNavEntry) => {
        if (e.kind === 'page') return menuRow(e.page, e.key, 0, v);
        const name =
          ui.renaming === e.key
            ? `<input class="edit" id="rename" type="text" value="${escape(e.name)}" data-key="${escape(e.key)}">`
            : `<span class="name" data-rename="${escape(e.key)}" title="${escape(l.rename)}">${escape(e.name)}</span>`;
        const addIn = `<button data-add-in="${escape(e.original)}" aria-label="${escape(format(l.addPageIn, e.name))}" title="${escape(format(l.addPageIn, e.name))}">+</button>`;
        return (
          `<div class="row" tabindex="0" role="treeitem" draggable="true" data-key="${escape(e.key)}" style="padding-left:8px"><span class="handle" aria-hidden="true">⋮⋮</span><span class="ic">§</span>${name}<span class="desc">${escape(l.section)}</span><span class="end">${moveButtons(e.key, addIn)}</span></div>` +
          e.pages.map(p => menuRow(p, p.path, 1, v)).join('') +
          (ui.adding?.section === e.original ? addInput(1, v) : '')
        );
      })
      .join('') + addArea(v)
  );
}

function addInput(depth: number, v: PreviewView) {
  const a = ui.adding!;
  const placeholder = a.kind === 'section' ? l.sectionPlaceholder : ui.mode === 'files' ? l.pathPlaceholder : l.titlePlaceholder;
  const types =
    a.kind === 'section'
      ? ''
      : `<select id="add-type" aria-label="${escape(l.pageType)}"><option value="">${escape(l.freePage)}</option>${v.pageTypes
          .map(t => `<option value="${escape(t.id)}"${a.type === t.id ? ' selected' : ''}>${escape(t.name)}</option>`)
          .join('')}</select>`;
  return `<div class="row" style="padding-left:${8 + depth * 18}px"><span class="handle"></span><span class="ic">${a.kind === 'section' ? '§' : 'M↓'}</span><input class="edit" id="add" type="text" placeholder="${escape(placeholder)}" aria-label="${escape(placeholder)}"></div>
    <div class="addhint" style="padding-left:${44 + depth * 18}px">${types}<span id="add-hint">${escape(ui.hint || l.addKeys)}</span></div>`;
}

function addArea(v: PreviewView) {
  if (ui.adding && ui.adding.section === undefined) return addInput(0, v);
  return `<div class="addrow"><button class="link" data-add="page">${escape(l.addPage)}</button>${ui.mode === 'menu' ? `<button class="link" data-add="section">${escape(l.addSection)}</button>` : ''}</div>`;
}

function foot(v: PreviewView) {
  const on = v.files.filter(f => f.included);
  const lack = v.missing.map(m => (m === 'owner' ? l.fillOwner : l.fillSiteName)).join(' ');
  const disabled = v.missing.length || v.error || v.busy ? ' disabled' : '';
  return `<div class="foot">
    ${v.error ? `<p class="error" role="alert">${escape(v.error)}</p>` : ''}
    ${lack ? `<div class="warnline" role="status">${escape(lack)} <button class="link" id="goto">${escape(l.fill)}</button></div>` : ''}
    <span class="summary">${format(l.summary, on.filter(f => f.status === 'new').length, on.filter(f => f.status === 'modified').length)}</span>
    <button class="btn" id="create"${disabled}>${escape(v.busy ? l.creating : l.create)}</button>
    <button class="btn secondary" id="cancel"${v.busy ? ' disabled' : ''}>${escape(l.cancel)}</button>
  </div>`;
}

/* ---------- eventos (delegados no root: o HTML é refeito a cada estado) ---------- */

const send = (message: PreviewMessage) => vscode.postMessage(message);

function startAdding(kind: 'page' | 'section', section?: string) {
  ui.adding = { kind, section, type: '' };
  ui.hint = '';
  render();
  document.getElementById('add')?.focus();
}

function finishAdding(save: boolean) {
  const a = ui.adding;
  const input = document.getElementById('add') as HTMLInputElement | null;
  ui.adding = undefined;
  ui.hint = '';
  if (save && a && input?.value.trim()) {
    if (a.kind === 'section') send({ type: 'addSection', name: input.value });
    else send({ type: 'add', text: input.value, by: ui.mode === 'files' ? 'path' : 'title', section: a.section, template: a.type || undefined });
  }
  render();
}

function finishRenaming(save: boolean) {
  const input = document.getElementById('rename') as HTMLInputElement | null;
  const key = ui.renaming;
  ui.renaming = undefined;
  if (save && key && input?.value.trim()) send({ type: 'rename', key, title: input.value });
  render();
}

root.addEventListener('input', e => {
  const target = e.target as HTMLInputElement;
  if (target.id === 'f-siteName') send({ type: 'set', field: 'siteName', value: target.value });
  if (target.id === 'f-owner') send({ type: 'set', field: 'owner', value: target.value });
  if (target.id === 'add' && ui.adding?.kind === 'page') {
    send({ type: 'add', hint: true, text: target.value, by: ui.mode === 'files' ? 'path' : 'title', section: ui.adding.section, template: ui.adding.type || undefined });
  }
});

root.addEventListener('change', e => {
  const target = e.target as HTMLInputElement & HTMLSelectElement;
  if (target.id === 'f-template') send({ type: 'set', field: 'template', value: target.value });
  if (target.id === 'f-readme') send({ type: 'set', field: 'readme', value: target.value });
  if (target.dataset.toggle) send({ type: 'toggle', path: target.dataset.toggle, on: target.checked });
  if (target.id === 'add-type' && ui.adding) {
    ui.adding.type = target.value;
    const input = document.getElementById('add') as HTMLInputElement;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

root.addEventListener('click', e => {
  const target = e.target as HTMLElement;
  const button = target.closest('button');
  if (button) {
    const d = button.dataset;
    if (d.mode) {
      ui.mode = d.mode as 'files' | 'menu';
      ui.adding = undefined;
      return render();
    }
    if (d.add) return startAdding(d.add as 'page' | 'section');
    if (d.addIn !== undefined) {
      const section = d.addIn;
      ui.adding = { kind: 'page', section, type: '' };
      render();
      return document.getElementById('add')?.focus();
    }
    if (d.remove) return send({ type: 'remove', path: d.remove });
    if (d.replace) return send({ type: 'replace', path: d.replace, replace: d.value === 'true' });
    if (d.up) return send({ type: 'move', key: d.up, delta: -1 });
    if (d.down) return send({ type: 'move', key: d.down, delta: 1 });
    if (button.id === 'create') return send({ type: 'create' });
    if (button.id === 'cancel') return send({ type: 'cancel' });
    if (button.id === 'goto') {
      const v = state.status === 'ready' ? state.view : undefined;
      return document.getElementById(v?.missing[0] === 'owner' ? 'f-owner' : 'f-siteName')?.focus();
    }
    return;
  }
  if (target.closest('input, select')) return;
  const row = target.closest<HTMLElement>('[data-open]');
  if (row?.dataset.open) send({ type: 'open', path: row.dataset.open });
});

root.addEventListener('dblclick', e => {
  const name = (e.target as HTMLElement).closest<HTMLElement>('[data-rename]');
  if (!name) return;
  ui.renaming = name.dataset.rename;
  render();
});

root.addEventListener('keydown', e => {
  const target = e.target as HTMLElement;
  if (target.id === 'add') {
    if (e.key === 'Enter') finishAdding(true);
    if (e.key === 'Escape') finishAdding(false);
    return;
  }
  if (target.id === 'rename') {
    if (e.key === 'Enter') finishRenaming(true);
    if (e.key === 'Escape') finishRenaming(false);
    return;
  }
  if (!target.classList.contains('row')) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (target.dataset.open) send({ type: 'open', path: target.dataset.open });
  }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && target.dataset.key) {
    e.preventDefault();
    send({ type: 'move', key: target.dataset.key, delta: e.key === 'ArrowUp' ? -1 : 1 });
  }
  if (e.key === 'F2') {
    const name = target.querySelector<HTMLElement>('[data-rename]');
    if (name) {
      ui.renaming = name.dataset.rename;
      render();
    }
  }
});

root.addEventListener('focusout', e => {
  const target = e.target as HTMLElement;
  const next = (e as FocusEvent).relatedTarget as HTMLElement | null;
  // Ir do campo da página nova para o tipo (e voltar) não fecha a página nova
  if ((target.id === 'add' || target.id === 'add-type') && ui.adding && next?.id !== 'add' && next?.id !== 'add-type') finishAdding(true);
  if (target.id === 'rename' && ui.renaming) finishRenaming(true);
});

// Arrastar no Menu: solta antes da linha de baixo
root.addEventListener('dragstart', e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
  if (!row) return;
  ui.dragging = row.dataset.key;
  e.dataTransfer?.setData('text/plain', ui.dragging!);
});
root.addEventListener('dragover', e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[draggable="true"]');
  if (!row || !ui.dragging || row.dataset.key === ui.dragging) return;
  e.preventDefault();
  root.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before'));
  row.classList.add('drop-before');
});
root.addEventListener('drop', e => {
  const row = (e.target as HTMLElement).closest<HTMLElement>('[draggable="true"]');
  e.preventDefault();
  if (row?.dataset.key && ui.dragging && row.dataset.key !== ui.dragging) send({ type: 'move', key: ui.dragging, before: row.dataset.key });
  ui.dragging = undefined;
});
root.addEventListener('dragend', () => {
  ui.dragging = undefined;
  root.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before'));
});

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as { type: 'state'; state: PreviewState; labels: PreviewLabels } | { type: 'hint'; text: string };
  if (message.type === 'hint') {
    ui.hint = message.text;
    const hint = document.getElementById('add-hint');
    if (hint) hint.textContent = message.text || l.addKeys;
    return;
  }
  const opened = state.status !== 'ready' && message.state.status === 'ready';
  state = message.state;
  l = message.labels;
  if (opened) Object.assign(ui, { mode: 'files', adding: undefined, renaming: undefined, hint: '' });
  render();
});

vscode.postMessage({ type: 'ready' });
