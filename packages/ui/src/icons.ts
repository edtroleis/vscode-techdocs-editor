/** Ícone da barra e do menu "/": um caminho SVG no formato 24×24 dos ícones do Crepe. */
export const icon = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${path}"/></svg>`;

/** Ícone de fluxograma (três caixas ligadas). */
export const DIAGRAM_ICON = icon('M3 3h6v4H3zm12 0h6v4h-6zM9 17h6v4H9zM6 7v4h12V7h-1v3H7V7zm5.5 4h1v6h-1z');
