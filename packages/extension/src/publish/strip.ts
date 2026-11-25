/** Ações da faixa de estado no topo da página (editor visual): o envio do repositório (spec 09). */
export type StripAction = 'send' | 'details' | 'openPr' | 'resolve' | 'showLine';

/**
 * Faixa no topo da página (editor visual): em que pé está o envio e a próxima ação, nas palavras de quem não
 * conhece Git (`send/sendStrip.ts`).
 */
export type Strip = {
  tone: 'done' | 'draft' | 'review' | 'problem';
  /** O estado em poucas palavras ("3 mudanças para enviar", "Em revisão"). */
  state: string;
  message: string;
  /** Envio em andamento: os passos, com o atual. */
  steps?: Array<{ label: string; status: 'done' | 'now' | 'todo' }>;
  actions: Array<{ action: StripAction; label: string; primary?: boolean }>;
  /** O menu "⋯": ações menos usadas. */
  menu: Array<{ action: StripAction; label: string }>;
  /** O ponto a corrigir (`showLine`). */
  line?: { path: string; line: number };
  /** O pedido de revisão (`openPr`). */
  url?: string;
};
