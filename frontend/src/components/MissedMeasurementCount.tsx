/**
 * Contagem GLOBAL de pacientes com período de hoje esquecido (janela fechada,
 * sem registro), usada no badge da sidebar — mesmo padrão de AlertCount.tsx,
 * mas alimentada por missed_measurement_logs (alerta operacional) em vez de
 * clinical_alerts (alerta clínico).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { missedMeasurementService } from '../services/missedMeasurementService';

interface MissedMeasurementCountValue {
  count: number;
  refresh: () => void;
}

const MissedMeasurementCountContext = createContext<MissedMeasurementCountValue>({ count: 0, refresh: () => {} });

export function MissedMeasurementCountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!user) {
      setCount(0);
      return;
    }
    missedMeasurementService.getPendingCount().then(setCount).catch(() => {});
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <MissedMeasurementCountContext.Provider value={value}>{children}</MissedMeasurementCountContext.Provider>;
}

export function useMissedMeasurementCount(): MissedMeasurementCountValue {
  return useContext(MissedMeasurementCountContext);
}
