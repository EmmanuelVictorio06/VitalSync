/**
 * Contagem GLOBAL de alertas não atendidos (Pendente + Em análise), usada no
 * badge da sidebar/bottom-nav. Fonte real (Supabase, escopo por RLS) — não mais
 * o mock de dashboard. A AlertsPage chama `refresh()` após carregar/atender para
 * o badge diminuir em tempo real.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { alertService } from '../services/alertService';

interface AlertCountValue {
  count: number;
  refresh: () => void;
}

const AlertCountContext = createContext<AlertCountValue>({ count: 0, refresh: () => {} });

export function AlertCountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!user) {
      setCount(0);
      return;
    }
    // O papel importa: o médico não conta o amarelo que está com a enfermagem.
    alertService.getUnattendedCount({ role: user.role, id: user.id }).then(setCount).catch(() => {});
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <AlertCountContext.Provider value={value}>{children}</AlertCountContext.Provider>;
}

export function useAlertCount(): AlertCountValue {
  return useContext(AlertCountContext);
}
