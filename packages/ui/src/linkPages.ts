import type { EditorView } from '@milkdown/kit/prose/view';

/** Página do site oferecida na caixa de link: o título do menu e o link relativo à página aberta. */
export type LinkPage = {
  title: string;
  /** O que vai no Markdown: relativo à página aberta (ex.: `../referencia-da-api.md`). */
  href: string;
  /** O caminho no `docs_dir`, mostrado ao lado do título. */
  detail: string;
  section?: string;
  /** Fora do menu do site (`nav`). */
  outside?: boolean;
};

export type LinkPagesText = { outside: string };

/** Endereço com esquema (https:, mailto:), âncora ou caminho absoluto: a pessoa está digitando um link, não uma página. */
const TYPED_LINK = /^([a-z][a-z0-9+.-]*:|#|\/)/i;
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * A caixa de link do Crepe só aceita um endereço: quem escreve tinha de saber o nome do arquivo e o caminho relativo.
 * Embaixo do campo, a lista das páginas do site; escolher uma põe o link relativo no campo e confirma com o Enter do
 * próprio Crepe. Sem texto selecionado, o texto do link passa a ser o título da página (e não o endereço).
 * O Crepe não tem como acrescentar itens à caixa: a lista é posta no DOM dela. Rever ao atualizar o Crepe.
 */
export function attachLinkPages(root: HTMLElement, view: () => EditorView, pages: () => Promise<LinkPage[]>, text: () => LinkPagesText) {
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let all: LinkPage[] = [];
  let shown: LinkPage[] = [];
  let active = -1;
  /** Seleção do texto quando a caixa abriu (o link vai nela). */
  let range = { from: 0, to: 0 };
  let request = 0;

  const linkInput = (target: EventTarget | null) =>
    target instanceof HTMLInputElement && target.closest('.milkdown-link-edit') ? target : undefined;

  const close = () => {
    list?.remove();
    list = undefined;
    shown = [];
    active = -1;
  };

  const render = () => {
    if (!input) return;
    const query = input.value.trim();
    shown = TYPED_LINK.test(query) ? [] : all.filter(p => fold(`${p.title} ${p.detail}`).includes(fold(query)));
    if (!shown.length) return close();
    active = Math.min(active, shown.length - 1);
    if (!list) {
      list = document.createElement('div');
      list.className = 'docs-link-pages';
      list.setAttribute('role', 'listbox');
      // Clicar na lista não pode tirar o foco do campo (a caixa do Crepe fecha)
      list.addEventListener('mousedown', event => event.preventDefault());
      input.closest('.milkdown-link-edit')!.appendChild(list);
    }
    list.replaceChildren(
      ...shown.map((page, i) => {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(i === active));
        option.className = i === active ? 'active' : '';
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = page.title;
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = page.outside ? `${page.detail} · ${text().outside}` : page.detail;
        option.append(title, detail);
        option.addEventListener('click', () => choose(page));
        option.addEventListener('mousemove', () => {
          if (active === i) return;
          active = i;
          render();
        });
        return option;
      }),
    );
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (page: LinkPage) => {
    const field = input;
    if (!field) return;
    const { from, to } = range;
    close();
    // O Crepe lê o campo pelo evento input e confirma no Enter
    field.value = page.href;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    if (from !== to) return;
    // Sem seleção, o Crepe escreve o endereço como texto do link: troca pelo título
    const editor = view();
    const { state } = editor;
    const end = from + page.href.length;
    if (end > state.doc.content.size || state.doc.textBetween(from, end) !== page.href) return;
    const marks = state.doc.resolve(end).marks();
    editor.dispatch(state.tr.replaceWith(from, end, state.schema.text(page.title, marks)));
  };

  const onFocusIn = (event: FocusEvent) => {
    const field = linkInput(event.target);
    if (!field || field === input) return;
    input = field;
    const { selection } = view().state;
    range = { from: selection.from, to: selection.to };
    active = -1;
    const current = ++request;
    void pages().then(
      result => {
        if (current !== request || input !== field) return;
        all = result;
        render();
      },
      () => undefined,
    );
  };

  const onFocusOut = (event: FocusEvent) => {
    if (!linkInput(event.target)) return;
    input = undefined;
    request++;
    close();
  };

  const onInput = (event: Event) => {
    if (!linkInput(event.target) || !event.isTrusted) return;
    active = input?.value.trim() ? 0 : -1;
    render();
  };

  // Antes do campo do Crepe (captura): as setas andam na lista e o Enter escolhe a página marcada
  const onKeyDown = (event: KeyboardEvent) => {
    if (!linkInput(event.target) || !shown.length || !event.isTrusted) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      active = event.key === 'ArrowDown' ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0);
      render();
    } else if (event.key === 'Enter' && active >= 0) {
      choose(shown[active]);
    } else if (event.key === 'Escape') {
      close();
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const owner = root.ownerDocument;
  owner.addEventListener('focusin', onFocusIn);
  owner.addEventListener('focusout', onFocusOut);
  owner.addEventListener('input', onInput, true);
  owner.addEventListener('keydown', onKeyDown, true);
  return () => {
    close();
    owner.removeEventListener('focusin', onFocusIn);
    owner.removeEventListener('focusout', onFocusOut);
    owner.removeEventListener('input', onInput, true);
    owner.removeEventListener('keydown', onKeyDown, true);
  };
}
