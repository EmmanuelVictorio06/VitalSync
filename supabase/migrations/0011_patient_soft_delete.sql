-- ============================================================================
-- VitalSync — Exclusão lógica (soft delete) de pacientes
--
-- Excluir um paciente NÃO apaga a linha: marca-se deleted_at/deleted_by. Os
-- dados (medições, fotos, alertas, atendimentos) continuam no banco para
-- histórico/auditoria e consulta administrativa futura.
--
-- Compatibilidade: o `status` continua sendo mantido em sincronia
-- (ACTIVE/INACTIVE) pela RPC de exclusão, então qualquer consulta legada que
-- ainda filtre por status = 'ACTIVE' segue correta enquanto o código migra para
-- o padrão canônico `deleted_at IS NULL`.
--
-- Rode no SQL Editor do Supabase após o 0010.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Colunas de auditoria da exclusão lógica.
-- ----------------------------------------------------------------------------
alter table public.patients
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- Índice parcial: acelera as listagens (o caso comum é "não deletados").
create index if not exists idx_patients_active on public.patients(team_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- updated_at automático (espelha o padrão de profiles).
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_patients_updated_at on public.patients;
create trigger trg_patients_updated_at
  before update on public.patients
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Backfill: pacientes já marcados como INACTIVE (esquema antigo de "exclusão")
-- passam a ter deleted_at preenchido para sumirem também pelo filtro novo.
-- ----------------------------------------------------------------------------
update public.patients
   set deleted_at = coalesce(deleted_at, now())
 where status = 'INACTIVE' and deleted_at is null;

-- ----------------------------------------------------------------------------
-- RPC: exclusão lógica do paciente (ADMIN ou cirurgião responsável da equipe).
-- Centraliza a regra: grava quem/quando excluiu, mantém status em sincronia e
-- silencia os alertas pendentes para que sumam das listas ativas.
-- ----------------------------------------------------------------------------
create or replace function public.soft_delete_patient(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select team_id into v_team from public.patients where id = p_id;
  if v_team is null then
    raise exception 'Paciente não encontrado.';
  end if;
  if not (public.is_admin() or public.is_main_surgeon_of(v_team)) then
    raise exception 'Sem permissão para excluir este paciente.';
  end if;

  update public.patients
     set deleted_at = now(),
         deleted_by = auth.uid(),
         status     = 'INACTIVE'   -- mantém compatibilidade com filtros legados
   where id = p_id and deleted_at is null;

  -- Alertas pendentes/em análise → IGNORED (somem das listas ativas).
  update public.clinical_alerts
     set attendance_status = 'IGNORED',
         ignored_reason     = 'Paciente excluído do monitoramento'
   where patient_id = p_id
     and attendance_status in ('PENDING', 'IN_ANALYSIS');
end;
$$;

grant execute on function public.soft_delete_patient(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RPC: restaurar paciente arquivado (somente ADMIN). Reabre a consulta dos
-- dados arquivados quando necessário, sem reescrever histórico.
-- ----------------------------------------------------------------------------
create or replace function public.restore_patient(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem restaurar pacientes.';
  end if;
  update public.patients
     set deleted_at = null,
         deleted_by = null,
         status     = 'ACTIVE'
   where id = p_id;
end;
$$;

grant execute on function public.restore_patient(uuid) to authenticated;
