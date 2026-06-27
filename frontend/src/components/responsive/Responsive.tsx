import { Fragment, type ReactNode } from 'react';
import { type Breakpoint, BREAKPOINTS_ORDER } from '@/constants/breakpoints';
import { useBreakpoint } from '@/hooks/useBreakpoint';

interface ResponsiveProps {
  /** Breakpoint mínimo (inclusivo) para renderizar. Ex.: min="lg". */
  min?: Breakpoint;
  /** Breakpoint máximo (inclusivo) para renderizar. Ex.: max="md". */
  max?: Breakpoint;
  children: ReactNode;
}

/**
 * Renderização condicional REAL por breakpoint.
 *
 * Diferente de `hidden md:block` / `md:hidden`, que mantêm os dois componentes
 * montados (rodando hooks, effects, queries e cálculos), o `Responsive` só monta
 * a árvore quando o breakpoint atual está dentro do intervalo. Use para versões
 * pesadas e distintas de mobile vs. desktop (tabelas, gráficos, listas grandes).
 *
 * Intervalos são inclusivos:
 *   <Responsive max="md">  → base, sm, md
 *   <Responsive min="lg">  → lg, xl, 2xl
 */
export function Responsive({ min, max, children }: ResponsiveProps) {
  const breakpoint = useBreakpoint();

  const breakpointIndex = BREAKPOINTS_ORDER.indexOf(breakpoint);
  const minIndex = min ? BREAKPOINTS_ORDER.indexOf(min) : 0;
  const maxIndex = max ? BREAKPOINTS_ORDER.indexOf(max) : BREAKPOINTS_ORDER.length - 1;

  const isVisible = breakpointIndex >= minIndex && breakpointIndex <= maxIndex;

  if (!isVisible) return null;

  return <Fragment>{children}</Fragment>;
}
