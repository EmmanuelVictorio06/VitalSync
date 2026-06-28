-- ============================================================================
-- VitalSync — Fase 7: consistência e constraints (M-04, M-12, M-13)
--
-- M-11 NÃO é aplicado: por decisão do dono, um cirurgião principal PODE liderar
-- várias equipes.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode no SQL Editor após o 0023.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- M-04: estado consistente attended × attendance_status no soft delete.
-- Ao marcar os alertas como IGNORED, também marca attended = true (com autor/
-- data), para não restarem como "não atendidos" nas contagens (.eq('attended',
-- false)) e na recompute_patient_status (0023).
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
         status     = 'INACTIVE'
   where id = p_id and deleted_at is null;

  -- Alertas pendentes/em análise → IGNORED E attended = true (estado coerente).
  update public.clinical_alerts
     set attendance_status = 'IGNORED',
         ignored_reason     = 'Paciente excluído do monitoramento',
         attended           = true,
         attended_by        = coalesce(attended_by, auth.uid()),
         attended_at        = coalesce(attended_at, now()),
         updated_at         = now()
   where patient_id = p_id
     and attendance_status in ('PENDING', 'IN_ANALYSIS');
end;
$$;

grant execute on function public.soft_delete_patient(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- M-12: team_members guarda APENAS médicos associados. O cirurgião principal
-- fica em medical_teams.main_surgeon_id (1 por equipe) — nunca em team_members.
-- CHECK NOT VALID: bloqueia novas inserções de MAIN_SURGEON sem reprovar linhas
-- legadas eventuais (não quebra o db push).
-- ----------------------------------------------------------------------------
do $$ begin
  alter table public.team_members
    add constraint team_members_assoc_only_chk
    check (role_in_team = 'ASSOCIATED_DOCTOR') not valid;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- M-13: um convite ATIVO por e-mail. Ao gerar um novo convite, expira os
-- anteriores não usados do mesmo e-mail. (create or replace — mesma assinatura
-- do 0017.)
-- ----------------------------------------------------------------------------
create or replace function public.create_professional_invite(
  p_role  text,
  p_team_id uuid default null,
  p_phone text default null,
  p_email text default null
)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not (public.is_admin() or public.is_support()) then
    raise exception 'Sem permissão para gerar convites.';
  end if;
  if p_role not in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
    raise exception 'Papel inválido para convite.';
  end if;

  -- Expira convites anteriores não usados do mesmo e-mail (um ativo por vez).
  if v_email is not null then
    update public.professional_invites
       set expires_at = now()
     where invited_email = v_email and used_at is null and expires_at > now();
  end if;

  insert into public.professional_invites (role, team_id, invited_phone, invited_email, created_by)
  values (
    p_role, p_team_id,
    nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''),
    v_email,
    auth.uid()
  )
  returning token into v_token;

  return v_token;
end;
$$;

grant execute on function public.create_professional_invite(text, uuid, text, text) to authenticated;
