import { createSlice } from '@milkdown/kit/ctx';

/**
 * Desfazer e refazer de fora do editor. Quando o texto vive em outro lugar com histórico próprio
 * (o documento do VS Code), o editor não pode ter um segundo histórico: os botões da barra e os
 * atalhos (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) chamam este, e o conteúdo novo chega por `setMarkdown`.
 * Sem ele (null), vale o histórico do ProseMirror, como no plugin.
 */
export type ExternalHistory = { undo: () => void; redo: () => void };

export const externalHistoryCtx = createSlice<ExternalHistory | null>(null, 'docsEditorExternalHistory');
