/** Ícone da barra e do menu "/": um caminho SVG no formato 24×24 dos ícones do Crepe. */
export const icon = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${path}"/></svg>`;

/** Ícone de fluxograma (três caixas ligadas). */
export const DIAGRAM_ICON = icon('M3 3h6v4H3zm12 0h6v4h-6zM9 17h6v4H9zM6 7v4h12V7h-1v3H7V7zm5.5 4h1v6h-1z');

/** Ícones dos modelos de diagrama do menu "/" (spec 06, M11). */
export const SEQUENCE_ICON = icon('M5 3h2v18H5zm12 0h2v18h-2zM7 8h7V6l3 3-3 3v-2H7zm10 6h-7v2l-3-3 3-3v2h7z');
export const STATE_ICON = icon('M6 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm3 2h3v2H9zm6-3h4a3 3 0 0 1 0 8h-4a3 3 0 0 1 0-8zm0 2a1 1 0 0 0 0 4h4a1 1 0 0 0 0-4z');
export const GANTT_ICON = icon('M3 5h9v3H3zm5 6h10v3H8zm6 6h7v3h-7z');
export const ENTITIES_ICON = icon('M2 5h8v14H2zm2 2v2h4V7zm10-2h8v14h-8zm2 2v2h4V7zm-6 4h4v2h-4z');

/** Ícones dos grupos de modelos novos (spec 06, M21): estrutura, gráficos e ideias. */
export const STRUCTURE_ICON = icon('M3 3h7v6H3zm11 0h7v6h-7zM8 15h8v6H8zM6 9h1v3h10V9h1v4h-5.5v2h-1v-2H6z');
export const CHART_ICON = icon('M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z');
export const IDEA_ICON = icon('M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM11 2h2v4h-2zm0 16h2v4h-2zM2 11h4v2H2zm16 0h4v2h-4z');
