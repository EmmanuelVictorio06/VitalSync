import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { lerTemaSalvo, resolverTemaEfetivo, themeColorPara, TEMA_STORAGE_KEY, type Tema, type TemaEfetivo } from '../lib/theme';

interface ThemeContextValue {
  /** Escolha do usuário — 'sistema' até que ele troque manualmente. */
  tema: Tema;
  /** Tema realmente aplicado na tela (já resolvido a partir de `tema` + SO). */
  temaEfetivo: TemaEfetivo;
  /** Clique simples: alterna claro ↔ escuro (sempre fixa uma escolha explícita). */
  alternarTema: () => void;
  /** Volta a acompanhar o tema do sistema operacional. */
  seguirSistema: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function aplicarNoDocumento(temaEfetivo: TemaEfetivo) {
  document.documentElement.classList.toggle('dark', temaEfetivo === 'escuro');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColorPara(temaEfetivo));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTemaState] = useState<Tema>(() => lerTemaSalvo(localStorage.getItem(TEMA_STORAGE_KEY)));
  const [sistemaPrefereEscuro, setSistemaPrefereEscuro] = useState(
    () => window.matchMedia(MEDIA_QUERY).matches,
  );

  // Acompanha o SO em tempo real — só importa de verdade quando `tema` é
  // 'sistema', mas não custa manter sempre atualizado.
  useEffect(() => {
    const mql = window.matchMedia(MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSistemaPrefereEscuro(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const temaEfetivo = useMemo(() => resolverTemaEfetivo(tema, sistemaPrefereEscuro), [tema, sistemaPrefereEscuro]);

  useEffect(() => {
    aplicarNoDocumento(temaEfetivo);
  }, [temaEfetivo]);

  const setTema = useCallback((novoTema: Tema) => {
    setTemaState(novoTema);
    localStorage.setItem(TEMA_STORAGE_KEY, novoTema);
  }, []);

  const alternarTema = useCallback(() => {
    setTema(temaEfetivo === 'escuro' ? 'claro' : 'escuro');
  }, [temaEfetivo, setTema]);

  const seguirSistema = useCallback(() => setTema('sistema'), [setTema]);

  const value = useMemo(
    () => ({ tema, temaEfetivo, alternarTema, seguirSistema }),
    [tema, temaEfetivo, alternarTema, seguirSistema],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme deve ser usado dentro de ThemeProvider');
  return ctx;
}
