/**
 * Badge da fila de triagem do Profissional de Enfermagem: alertas ofertados a
 * mim + fila aberta. Mesmo padrão de AlertCount.tsx / MissedMeasurementCount.tsx.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Role, useAuth } from '../auth/AuthContext';
import { alertService } from '../services/alertService';

interface NurseQueueCountValue {
  count: number;
  refresh: () => void;
}

const NurseQueueCountContext = createContext<NurseQueueCountValue>({ count: 0, refresh: () => {} });

export function NurseQueueCountProvider({ children }: { children: ReactNode }) {
  const { user, hasRole } = useAuth();
  const isNurse = hasRole(Role.NURSE);
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    // Só a enfermagem tem fila de triagem — evita a query para os demais papéis.
    if (!user || !isNurse) {
      setCount(0);
      return;
    }
    alertService.getNurseQueueCount().then(setCount).catch(() => {});
  }, [user, isNurse]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <NurseQueueCountContext.Provider value={value}>{children}</NurseQueueCountContext.Provider>;
}

export function useNurseQueueCount(): NurseQueueCountValue {
  return useContext(NurseQueueCountContext);
}
