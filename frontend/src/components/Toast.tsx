import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from './ui';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; type: ToastType; message: string; }

interface ToastContextValue {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const META: Record<ToastType, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-stable' },
  error: { icon: AlertCircle, cls: 'text-alert' },
  info: { icon: Info, cls: 'text-primary' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const value: ToastContextValue = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
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
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return ctx;
}
