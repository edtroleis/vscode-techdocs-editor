/**
 * Janela de zoom do diagrama (spec 06, M28): o botão Ampliar do bloco abre o desenho por cima da página, com zoom
 * pela roda do mouse (no ponteiro), arrastar para mover, −/+, Ajustar e 100%, e o teclado (+, −, 0, 1, setas, Esc).
 */

export type DiagramViewerText = {
  /** Botão do bloco e título da janela. */
  open: string;
  title: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  actualSize: string;
  close: string;
  /** Rodapé com os atalhos. */
  help: string;
};

const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
/** Ajustar um desenho muito largo deixaria o texto ilegível: abaixo disso ele ajusta pela altura, a partir da esquerda. */
const MIN_FIT_SCALE = 0.35;
const MARGIN = 24;

let closeOpen: (() => void) | undefined;

const button = (action: string, label: string, title: string) => {
  const node = document.createElement('button');
  node.type = 'button';
  node.dataset.action = action;
  node.textContent = label;
  node.title = title;
  node.setAttribute('aria-label', title);
  return node;
};

/** Abre `svg` (uma cópia: o desenho da página fica) na janela de zoom; ao fechar, o foco volta para `opener`. */
export function openDiagramViewer(svg: SVGSVGElement, text: DiagramViewerText, opener?: HTMLElement) {
  closeOpen?.();
  const host = svg.closest<HTMLElement>('.milkdown') ?? document.body;
  const box = svg.viewBox.baseVal;
  const width = box?.width || svg.getBoundingClientRect().width;
  const height = box?.height || svg.getBoundingClientRect().height;

  const backdrop = document.createElement('div');
  backdrop.className = 'diagram-viewer-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'diagram-viewer';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', text.title);
  const bar = document.createElement('div');
  bar.className = 'diagram-viewer-bar';
  const title = document.createElement('span');
  title.className = 'diagram-viewer-title';
  title.textContent = text.title;
  const percent = document.createElement('span');
  percent.className = 'diagram-viewer-percent';
  percent.setAttribute('aria-live', 'polite');
  const fitButton = button('fit', text.fit, text.fit);
  bar.append(
    title,
    button('out', '−', text.zoomOut),
    percent,
    button('in', '+', text.zoomIn),
    fitButton,
    button('one', '100%', text.actualSize),
    button('close', '×', text.close),
  );
  const stage = document.createElement('div');
  stage.className = 'diagram-viewer-stage';
  const canvas = document.createElement('div');
  canvas.className = 'diagram-viewer-canvas';
  const copy = svg.cloneNode(true) as SVGSVGElement;
  // Tamanho natural, sem o min-width e o max-width do bloco: o zoom é o transform
  copy.removeAttribute('style');
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  canvas.append(copy);
  stage.append(canvas);
  const help = document.createElement('div');
  help.className = 'diagram-viewer-help';
  help.textContent = text.help;
  dialog.append(bar, stage, help);
  backdrop.append(dialog);
  host.append(backdrop);

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    percent.textContent = `${Math.round(scale * 100)}%`;
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    x = cx - ((cx - x) * next) / scale;
    y = cy - ((cy - y) * next) / scale;
    scale = next;
    apply();
  };
  const center = () => [stage.clientWidth / 2, stage.clientHeight / 2] as const;
  const fit = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    scale = Math.min(1, (w - 2 * MARGIN) / width, (h - 2 * MARGIN) / height);
    if (scale < MIN_FIT_SCALE) {
      scale = Math.min(1, (h - 2 * MARGIN) / height, 0.8);
      x = MARGIN;
    } else x = (w - width * scale) / 2;
    y = height * scale > h ? MARGIN : (h - height * scale) / 2;
    apply();
  };
  const actualSize = () => zoomAt(1 / scale, ...center());
  fit();

  stage.addEventListener(
    'wheel',
    event => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );
  let drag: { px: number; py: number; x: number; y: number } | undefined;
  stage.addEventListener('pointerdown', event => {
    drag = { px: event.clientX, py: event.clientY, x, y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', event => {
    if (!drag) return;
    x = drag.x + event.clientX - drag.px;
    y = drag.y + event.clientY - drag.py;
    apply();
  });
  const endDrag = () => {
    drag = undefined;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  const finish = () => {
    closeOpen = undefined;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    opener?.focus();
  };
  closeOpen = finish;
  bar.addEventListener('click', event => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'in') zoomAt(1.25, ...center());
    else if (action === 'out') zoomAt(0.8, ...center());
    else if (action === 'fit') fit();
    else if (action === 'one') actualSize();
    else if (action === 'close') finish();
  });
  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) finish();
  });
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [60, 0],
    ArrowRight: [-60, 0],
    ArrowUp: [0, 60],
    ArrowDown: [0, -60],
  };
  const onKey = (event: KeyboardEvent) => {
    const { key } = event;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (key === 'Escape') {
      handled();
      finish();
    } else if (key === 'Tab') {
      // Tab fica dentro da janela
      handled();
      const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    } else if (key === '+' || key === '=') {
      handled();
      zoomAt(1.25, ...center());
    } else if (key === '-') {
      handled();
      zoomAt(0.8, ...center());
    } else if (key === '0') {
      handled();
      fit();
    } else if (key === '1') {
      handled();
      actualSize();
    } else if (moves[key]) {
      handled();
      x += moves[key][0];
      y += moves[key][1];
      apply();
    } else if (key !== 'Enter' && key !== ' ') {
      // O resto não vai para o editor por trás
      event.stopPropagation();
    }
  };
  document.addEventListener('keydown', onKey, true);
  fitButton.focus();
}

/** Fecha a janela de zoom aberta (a página trocou, por exemplo). */
export const closeDiagramViewer = () => closeOpen?.();
