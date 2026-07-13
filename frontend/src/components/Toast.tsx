import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from './ui';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; type: ToastType; message: string; }

interface ToastContextValue {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
  welcome: (m: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const META: Record<ToastType, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-stable' },
  error: { icon: AlertCircle, cls: 'text-alert' },
  info: { icon: Info, cls: 'text-primary' },
};

// Mobile = abaixo de sm (640px), mesmo critério usado em AttendanceActionsMenu.
const MOBILE_QUERY = '(max-width: 639px)';
const WELCOME_DURATION_MS = 1800; // entre 1,5s e 2s

function isMobileViewport() {
  return typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [welcome, setWelcome] = useState<{ id: number; message: string } | null>(null);
  const welcomeTimer = useRef<number | undefined>(undefined);

  const push = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismissWelcome = useCallback(() => {
    setWelcome(null);
    if (welcomeTimer.current !== undefined) {
      clearTimeout(welcomeTimer.current);
      welcomeTimer.current = undefined;
    }
  }, []);

  // Toast de boas-vindas mobile: discreto, abaixo do cabeçalho, some em 1,8s
  // e ao toque na tela. No desktop cai no fluxo padrão (success), inalterado.
  const pushWelcome = useCallback(
    (message: string) => {
      const id = Date.now() + Math.random();
      setWelcome({ id, message });
      if (welcomeTimer.current !== undefined) clearTimeout(welcomeTimer.current);
      welcomeTimer.current = window.setTimeout(dismissWelcome, WELCOME_DURATION_MS);
    },
    [dismissWelcome],
  );

  // Fecha a boas-vindas ao tocar/clicar em qualquer lugar da tela (capture
  // garante o disparo mesmo se o alvo parar a propagação). Como o container é
  // pointer-events-none, o toque passa para o elemento abaixo — não bloqueia
  // cliques em botões/menus/três pontinhos.
  useEffect(() => {
    if (!welcome) return;
    document.addEventListener('click', dismissWelcome, true);
    return () => document.removeEventListener('click', dismissWelcome, true);
  }, [welcome, dismissWelcome]);

  // Limpa o timer pendente ao desmontar (segurança).
  useEffect(
    () => () => {
      if (welcomeTimer.current !== undefined) clearTimeout(welcomeTimer.current);
    },
    [],
  );

  const value: ToastContextValue = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
    welcome: (m) => {
      if (isMobileViewport()) pushWelcome(m);
      else push('success', m);
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toasts padrão (desktop e mobile) — posicionamento e tempo inalterados */}
      <div
        className="fixed top-4 right-4 left-4 sm:left-auto z-[1000] flex flex-col gap-2 items-end"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => {
          const Icon = META[t.type].icon;
          return (
            <div
              key={t.id}
              className="w-full sm:w-auto sm:min-w-72 max-w-md bg-card border border-border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 text-sm font-medium animate-entry"
            >
              <Icon className={cn('size-4 shrink-0', META[t.type].cls)} aria-hidden />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>

      {/* Boas-vindas mobile: toast flutuante abaixo do cabeçalho (top-24, ou
          seja, 96px — abaixo do header h-16), não bloqueia cliques
          (pointer-events-none), some em 1,8s e ao tocar na tela. Visível só
          abaixo de sm (sm:hidden). */}
      {welcome && (
        <div
          key={welcome.id}
          className="sm:hidden fixed top-24 inset-x-4 z-[1000] flex justify-center pointer-events-none"
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 text-sm font-medium animate-entry">
            <CheckCircle2 className="size-4 shrink-0 text-stable" aria-hidden />
            <span>{welcome.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return ctx;
}
