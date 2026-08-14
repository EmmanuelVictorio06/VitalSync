/**
 * Matemática pura de zoom/pan do `ViewImageModal` (frontend/src/components/photo.tsx).
 *
 * `viewportW`/`viewportH` são o tamanho (px) da janela visível — não muda com o zoom.
 * `contentW`/`contentH` são o tamanho (px) da imagem em 100% (o "encaixe" original,
 * antes de qualquer ampliação). `offsetX`/`offsetY` são o deslocamento do centro da
 * imagem em relação ao centro do viewport, em pixels de tela.
 */

export interface ZoomState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Zoom mínimo: sempre o "encaixe" original, nunca menos. */
export const MIN_SCALE = 1;
/**
 * Zoom máximo: 400%. Suficiente para avaliar borda de incisão, secreção e
 * coloração sem esticar demais fotos tiradas em celular — acima disso a
 * interpolação degrada a leitura clínica em vez de ajudar.
 */
export const MAX_SCALE = 4;
/** Fator multiplicativo por incremento (roda do mouse e botões +/−) — passo suave. */
export const ZOOM_STEP_FACTOR = 1.2;
/** Nível alvo do duplo clique quando a imagem está em 100%. */
export const DOUBLE_CLICK_SCALE = 2;
/** Deslocamento por pressão de seta, em pixels de tela. */
export const ARROW_PAN_STEP = 40;
/** Distância máxima (px) entre pointerdown e pointerup para contar como clique, não arraste. */
export const CLICK_DRAG_THRESHOLD = 5;

export function createInitialZoomState(): ZoomState {
  return { scale: MIN_SCALE, offsetX: 0, offsetY: 0 };
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Restringe o pan para que a imagem sempre preencha o viewport (nunca sobra área vazia). */
export function clampPan(
  state: ZoomState,
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
): ZoomState {
  const scaledW = contentW * state.scale;
  const scaledH = contentH * state.scale;
  const maxOffsetX = Math.max(0, (scaledW - viewportW) / 2);
  const maxOffsetY = Math.max(0, (scaledH - viewportH) / 2);
  return {
    scale: state.scale,
    offsetX: Math.min(maxOffsetX, Math.max(-maxOffsetX, state.offsetX)),
    offsetY: Math.min(maxOffsetY, Math.max(-maxOffsetY, state.offsetY)),
  };
}

export function resetZoom(): ZoomState {
  return createInitialZoomState();
}

/**
 * Amplia/reduz mantendo o ponto (pointX, pointY) — coordenadas relativas ao
 * viewport — fixo sob o cursor. Ao voltar para o mínimo, zera o pan.
 */
export function zoomAtPoint(
  state: ZoomState,
  factor: number,
  pointX: number,
  pointY: number,
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
): ZoomState {
  const newScale = clampScale(state.scale * factor);
  if (newScale <= MIN_SCALE) return resetZoom();

  const k = newScale / state.scale;
  const centerX = viewportW / 2;
  const centerY = viewportH / 2;
  const newOffsetX = (pointX - centerX) * (1 - k) + k * state.offsetX;
  const newOffsetY = (pointY - centerY) * (1 - k) + k * state.offsetY;

  return clampPan(
    { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY },
    viewportW,
    viewportH,
    contentW,
    contentH,
  );
}

/** Move a imagem por (dx, dy) pixels de tela; sem efeito quando não há ampliação. */
export function panBy(
  state: ZoomState,
  dx: number,
  dy: number,
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
): ZoomState {
  if (state.scale <= MIN_SCALE) return state;
  return clampPan(
    { scale: state.scale, offsetX: state.offsetX + dx, offsetY: state.offsetY + dy },
    viewportW,
    viewportH,
    contentW,
    contentH,
  );
}

/** Duplo clique: alterna entre 100% e o nível ampliado, ancorado no ponto clicado. */
export function toggleDoubleClickZoom(
  state: ZoomState,
  pointX: number,
  pointY: number,
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
): ZoomState {
  if (state.scale > MIN_SCALE) return resetZoom();
  return zoomAtPoint(state, DOUBLE_CLICK_SCALE, pointX, pointY, viewportW, viewportH, contentW, contentH);
}
