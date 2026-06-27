/**
 * Badge "Ambiente de teste" exibido no topo durante a homologação médica.
 *
 * Heurística de Nielsen "visibilidade do status do sistema": deixa claro que o
 * ambiente é de testes, sem poluir a interface. Aparece quando o modo está fixo
 * na build (env) OU ativado pelo Administrador no banco.
 */
import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { isHomologationModeEnv } from '../config/environment';
import { isSupabaseConfigured } from '../lib/supabase';
import { homologationService } from '../services/homologationService';

export function HomologationBadge() {
  const [active, setActive] = useState(isHomologationModeEnv);

  useEffect(() => {
    // Se já está fixo na build, ou Supabase não configurado, não consulta o banco.
    if (isHomologationModeEnv || !isSupabaseConfigured) return;
    let alive = true;
    homologationService
      .isActive()
      .then((v) => alive && setActive(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!active) return null;

  return (
    <span
      role="status"
      title="Este ambiente está sendo usado para testes internos antes da liberação para pacientes."
      className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-warning shrink-0"
    >
      <FlaskConical className="size-3.5" />
      <span className="hidden sm:inline">Ambiente de teste</span>
      <span className="sm:hidden">Teste</span>
    </span>
  );
}
