import { useEffect, useState } from 'react';
import { type Breakpoint, BREAKPOINTS_WIDTH } from '@/constants/breakpoints';

function calcBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'base';

  const width = window.innerWidth;

  if (width >= BREAKPOINTS_WIDTH['2xl']) return '2xl';
  if (width >= BREAKPOINTS_WIDTH.xl) return 'xl';
  if (width >= BREAKPOINTS_WIDTH.lg) return 'lg';
  if (width >= BREAKPOINTS_WIDTH.md) return 'md';
  if (width >= BREAKPOINTS_WIDTH.sm) return 'sm';

  return 'base';
}

/**
 * Detecta o breakpoint atual e reage ao resize.
 *
 * - Seguro para SSR/ambientes sem `window` (retorna "base").
 * - Faz throttle do resize via `requestAnimationFrame` para evitar re-render em
 *   excesso durante o arraste da janela.
 * - Só dispara `setState` quando o breakpoint realmente muda.
 */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(calcBreakpoint);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let frame = 0;

    const handleResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setBreakpoint((prev) => {
          const next = calcBreakpoint();
          return next === prev ? prev : next;
        });
      });
    };

    // Sincroniza caso a largura tenha mudado entre o render inicial e a montagem.
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return breakpoint;
}
