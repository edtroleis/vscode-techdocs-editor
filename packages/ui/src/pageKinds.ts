import { createSlice } from '@milkdown/kit/ctx';

/**
 * Tipos de página (Runbook, Tutorial…) no editor visual: o botão deles na barra e o grupo no menu "/". A lista e
 * o texto de cada tipo vêm da extensão (os templates de página do site); `pick` pede o texto, que entra no cursor.
 */
export type PageKind = { id: string; label: string; description: string };
export type PageKinds = { group: string; kinds: PageKind[]; pick(id: string): void };

export const pageKindsCtx = createSlice<PageKinds>({ group: '', kinds: [], pick: () => undefined }, 'docsEditorPageKinds');

const svg = (inner: string) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${inner}</svg>`;
/** Uma página com linhas: o ícone de todos os tipos. */
export const ICON_PAGE_KIND = svg('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 11h7M9 14h7M9 17h4"/>');
