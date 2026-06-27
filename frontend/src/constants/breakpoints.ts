/**
 * Breakpoints centralizados, alinhados aos valores padrão do Tailwind.
 * Usados pelo hook `useBreakpoint` e pelo wrapper `Responsive` para fazer
 * renderização condicional real (montando só a versão necessária da tela).
 */
export type Breakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export const BREAKPOINTS_ORDER: Breakpoint[] = ['base', 'sm', 'md', 'lg', 'xl', '2xl'];

export const BREAKPOINTS_WIDTH: Record<Breakpoint, number> = {
  base: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};
