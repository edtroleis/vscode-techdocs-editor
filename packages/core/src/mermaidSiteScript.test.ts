// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MERMAID_COLORS_SCRIPT } from './mermaidConfig';

/**
 * O script do site (M25, M27, M28) com um Mermaid de mentira, como o MkDocs Material o usa: initialize com o
 * themeCSS dele, render, e o fn com o shadow root fechado onde o desenho foi posto.
 */
const SVG = '<svg id="d" viewBox="0 0 1000 50" style="max-width: 1000px;"><g></g></svg>';

async function load(lang = 'pt-BR') {
  document.documentElement.lang = lang;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.setAttribute('data-md-color-scheme', 'default');
  const initialize = vi.fn();
  const render = vi.fn(async () => ({ svg: SVG }));
  (window as unknown as { mermaid: unknown }).mermaid = { initialize, render };
  new Function(MERMAID_COLORS_SCRIPT)();
  const mermaid = (window as unknown as { mermaid: { initialize: (c: object) => void; render: (id: string, code: string) => Promise<{ svg: string; fn: (s: ShadowRoot) => void }> } }).mermaid;
  mermaid.initialize({ startOnLoad: false, themeCSS: '.x{}' });
  const result = await mermaid.render('__mermaid_0', 'flowchart LR\n  A-->B');
  const host = document.createElement('div');
  host.className = 'mermaid';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = result.svg;
  document.body.append(host);
  result.fn(shadow);
  return { initialize, render, result, shadow };
}

describe('script do site', () => {
  it('tema colorido no lugar das cores do Material, e o desenho largo com min-width de 60%', async () => {
    const { initialize, result } = await load();
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ startOnLoad: false, theme: 'redux-color' }));
    expect(initialize.mock.calls[0][0]).not.toHaveProperty('themeCSS');
    expect(result.svg).toContain('style="min-width: 600px; max-width: 1000px;"');
  });

  it('Ampliar (M28): botão no desenho, sempre à vista num largo; abre a janela, Esc fecha', async () => {
    const { shadow } = await load();
    const button = shadow.querySelector<HTMLButtonElement>('.tde-bar button')!;
    expect(button.textContent).toBe('Ampliar');
    expect(shadow.querySelector('.tde-bar')!.classList.contains('big')).toBe(true);
    expect(shadow.querySelector('.tde-scroll > svg')).not.toBeNull();
    button.click();
    const viewer = document.querySelector('.tde-viewer')!;
    expect(viewer.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Diagrama');
    // A cópia sem o min-width do bloco
    expect(viewer.querySelector('.tde-canvas svg')!.getAttribute('style')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.tde-viewer')).toBeNull();
  });

  it('em inglês fora de pt', async () => {
    const { shadow } = await load('en');
    expect(shadow.querySelector('.tde-bar button')!.textContent).toBe('Enlarge');
  });

  it('trocar para o escuro redesenha com o tema escuro', async () => {
    const { initialize, render, shadow } = await load();
    document.body.setAttribute('data-md-color-scheme', 'slate');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'redux-dark-color' }));
    expect(render).toHaveBeenLastCalledWith(expect.stringMatching(/^tde-redraw-/), 'flowchart LR\n  A-->B');
    await vi.waitFor(() => expect(shadow.querySelectorAll('.tde-bar')).toHaveLength(1));
  });
});
