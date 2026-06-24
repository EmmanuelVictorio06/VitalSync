-- ============================================================================
-- VitalSync — Configurações (Geral/WhatsApp/Segurança) + Auditoria
-- Rode no SQL Editor após 0001/0002.
-- ============================================================================

-- Configurações por seção (jsonb). Somente ADMIN lê/escreve.
create table if not exists public.app_settings (
  section    text primary key,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin on public.app_settings;
create policy app_settings_admin on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Trilha de auditoria. ADMIN lê; inserções vêm dos triggers (security definer).
create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_name text not null default '—',
  actor_role text not null default '—',
  action     text not null,
  entity     text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_created on public.audit_logs(created_at desc);
alter table public.audit_logs enable row level security;
drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.is_admin());

-- Trigger genérico: registra cadastro de paciente, medição e alerta.
create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text; v_action text; v_entity text; v_pname text;
begin
  select p.name, p.role::text into v_name, v_role from public.profiles p where p.id = auth.uid();

  if TG_TABLE_NAME = 'patients' then
    v_action := 'PATIENT_CREATE';
    v_entity := 'Paciente · ' || NEW.name;
    if v_name is null then v_name := 'Sistema'; v_role := '—'; end if;
  elsif TG_TABLE_NAME = 'vital_sign_records' then
    v_action := 'VITALS_RECORD';
    select name into v_pname from public.patients where id = NEW.patient_id;
    v_entity := 'Paciente · ' || coalesce(v_pname, '—');
    if v_name is null then v_name := 'Paciente (link)'; v_role := 'Paciente'; end if;
  elsif TG_TABLE_NAME = 'clinical_alerts' then
    v_action := 'ALERT_GENERATED';
    select name into v_pname from public.patients where id = NEW.patient_id;
    v_entity := 'Paciente · ' || coalesce(v_pname, '—');
    if v_name is null then v_name := 'Sistema'; v_role := 'Automático'; end if;
  else
    return NEW;
  end if;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (coalesce(v_name, '—'), coalesce(v_role, '—'), v_action, v_entity);
  return NEW;
end;
$$;

drop trigger if exists trg_audit_patients on public.patients;
create trigger trg_audit_patients after insert on public.patients for each row execute function public.log_audit();
drop trigger if exists trg_audit_vitals on public.vital_sign_records;
create trigger trg_audit_vitals after insert on public.vital_sign_records for each row execute function public.log_audit();
drop trigger if exists trg_audit_alerts on public.clinical_alerts;
create trigger trg_audit_alerts after insert on public.clinical_alerts for each row execute function public.log_audit();
