import { describe, it, expect } from 'vitest';
import {
  MIN_SCALE,
  MAX_SCALE,
  createInitialZoomState,
  clampPan,
  zoomAtPoint,
  panBy,
  toggleDoubleClickZoom,
} from './imageZoom';

// Viewport e conteúdo (imagem em 100%) do mesmo tamanho — caso comum de uma
// foto que preenche a janela do modal.
const VIEWPORT_W = 800;
const VIEWPORT_H = 600;
const CONTENT_W = 800;
const CONTENT_H = 600;

describe('zoomAtPoint — âncora no cursor', () => {
  it('ampliar no canto superior esquerdo mantém esse ponto fixo sob o cursor', () => {
    const state = createInitialZoomState();
    const result = zoomAtPoint(state, 2, 0, 0, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.scale).toBeCloseTo(2);
    // canto esquerdo/superior "puxa" a imagem para a direita/baixo para permanecer sob o cursor
    expect(result.offsetX).toBeCloseTo(400);
    expect(result.offsetY).toBeCloseTo(300);
  });

  it('ampliar no centro não desloca a imagem', () => {
    const state = createInitialZoomState();
    const result = zoomAtPoint(state, 2, VIEWPORT_W / 2, VIEWPORT_H / 2, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.scale).toBeCloseTo(2);
    expect(result.offsetX).toBeCloseTo(0);
    expect(result.offsetY).toBeCloseTo(0);
  });

  it('ampliar no canto inferior direito mantém esse ponto fixo sob o cursor', () => {
    const state = createInitialZoomState();
    const result = zoomAtPoint(state, 2, VIEWPORT_W, VIEWPORT_H, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.scale).toBeCloseTo(2);
    expect(result.offsetX).toBeCloseTo(-400);
    expect(result.offsetY).toBeCloseTo(-300);
  });
});

describe('zoomAtPoint — limites', () => {
  it('nunca reduz abaixo do zoom mínimo (100%)', () => {
    const state = createInitialZoomState();
    const result = zoomAtPoint(state, 0.5, 400, 300, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.scale).toBe(MIN_SCALE);
  });

  it('nunca ultrapassa o zoom máximo mesmo com fator muito grande', () => {
    const state = createInitialZoomState();
    const result = zoomAtPoint(state, 100, 400, 300, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.scale).toBe(MAX_SCALE);
  });

  it('aplicado em sequência, o fator também é limitado ao máximo', () => {
    let state = createInitialZoomState();
    for (let i = 0; i < 10; i++) {
      state = zoomAtPoint(state, 1.5, 400, 300, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);
    }
    expect(state.scale).toBe(MAX_SCALE);
  });

  it('reduzir de volta ao mínimo zera o pan (recentraliza a imagem)', () => {
    const zoomed = zoomAtPoint(createInitialZoomState(), 2, 0, 0, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);
    expect(zoomed.offsetX).not.toBe(0);

    const backToMin = zoomAtPoint(zoomed, 0.5, 0, 0, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);
    expect(backToMin.scale).toBe(MIN_SCALE);
    expect(backToMin.offsetX).toBe(0);
    expect(backToMin.offsetY).toBe(0);
  });

  it('ampliar e depois reduzir pelo fator inverso volta ao estado inicial', () => {
    const initial = createInitialZoomState();
    const zoomed = zoomAtPoint(initial, 1.5, 700, 100, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);
    const restored = zoomAtPoint(zoomed, 1 / 1.5, 700, 100, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(restored.scale).toBeCloseTo(initial.scale, 5);
    expect(restored.offsetX).toBeCloseTo(initial.offsetX, 5);
    expect(restored.offsetY).toBeCloseTo(initial.offsetY, 5);
  });
});

describe('clampPan', () => {
  it('trava o pan nas bordas — não deixa sobrar área vazia dentro do viewport', () => {
    const state = { scale: 2, offsetX: 1000, offsetY: 1000 };
    const result = clampPan(state, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    // conteúdo em 2x = 1600x1200; excesso sobre o viewport (800x600) é 400 e 300
    expect(result.offsetX).toBe(400);
    expect(result.offsetY).toBe(300);
  });

  it('em 100% (sem ampliação) o offset é sempre zerado', () => {
    const state = { scale: 1, offsetX: 999, offsetY: 999 };
    const result = clampPan(state, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it('quando um eixo do conteúdo cabe inteiro no viewport mesmo ampliado, esse eixo fica travado em 0', () => {
    // imagem estreita: 100x600 em 100%, mesmo em 4x (400x2400) a largura (400) ainda cabe no viewport (800)
    const narrowContentW = 100;
    const state = { scale: MAX_SCALE, offsetX: 500, offsetY: 500 };
    const result = clampPan(state, VIEWPORT_W, VIEWPORT_H, narrowContentW, CONTENT_H);

    expect(result.offsetX).toBe(0); // eixo X nunca "sobra" espaço vazio arrastando
    expect(result.offsetY).toBeGreaterThan(0); // eixo Y (altura) segue travado na borda normalmente
  });
});

describe('panBy', () => {
  it('arrastar além da borda é travado pelo clamp', () => {
    const zoomed = { scale: 2, offsetX: 0, offsetY: 0 };
    const result = panBy(zoomed, 10000, 10000, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.offsetX).toBe(400);
    expect(result.offsetY).toBe(300);
  });

  it('em 100% arrastar não move a imagem', () => {
    const state = createInitialZoomState();
    const result = panBy(state, 200, 200, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result).toEqual(state);
  });
});

describe('toggleDoubleClickZoom', () => {
  it('duplo clique em 100% amplia ancorado no ponto clicado', () => {
    const state = createInitialZoomState();
    const result = toggleDoubleClickZoom(state, 0, 0, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.scale).toBeGreaterThan(MIN_SCALE);
  });

  it('duplo clique já ampliado volta a 100% sem pan residual', () => {
    const zoomed = zoomAtPoint(createInitialZoomState(), 2, 0, 0, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);
    const result = toggleDoubleClickZoom(zoomed, 0, 0, VIEWPORT_W, VIEWPORT_H, CONTENT_W, CONTENT_H);

    expect(result.scale).toBe(MIN_SCALE);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });
});
