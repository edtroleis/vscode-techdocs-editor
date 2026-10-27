/**
 * No lugar do KaTeX no bundle do webview (spec 00, R3/R4). O Crepe importa o KaTeX sempre, mas só o
 * usa com o recurso de LaTeX, que fica desligado (o MkDocs do TechDocs não renderiza `$...$`). Fora do
 * bundle, são 263 KB a menos e os avisos do `npm audit` do KaTeX deixam de valer para a extensão.
 */
const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default {
  render(code: string, element: HTMLElement) {
    element.textContent = code;
  },
  renderToString(code: string) {
    return `<code>${escape(code)}</code>`;
  },
};
