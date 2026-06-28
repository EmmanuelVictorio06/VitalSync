-- ============================================================================
-- VitalSync — Cirurgião gerencia as PRÓPRIAS equipes (autoatendimento)
--
-- Permite a um MAIN_SURGEON criar/gerir suas equipes, com limites e permissões
-- garantidos NO BANCO (não dá para burlar pelo frontend):
--   • máx. 5 equipes ATIVAS por cirurgião;
--   • máx. 10 médicos associados ATIVOS por equipe (o responsável não conta).
--
-- Decisões (o spec delega):
--   • Identidade da equipe = team_number (não há coluna name; não criamos uma).
--   • "Arquivar" = status='INACTIVE' (não há archived_at; não criamos).
--
-- NOTA DE NUMERAÇÃO: o spec sugeria 0020, mas 0020..0027 já estão em uso (PRs
-- em andamento) — usar 0020 quebraria o db push (prefixo duplicado). Por isso 0028.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode no SQL Editor após o 0019.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Helpers de contagem (limites). Constantes (5/10) vivem nas funções abaixo,
--    espelhadas no front por frontend/src/lib/teamLimits.ts (fonte única no TS).
-- ----------------------------------------------------------------------------
create or replace function public.count_active_teams_by_surgeon(p_surgeon uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.medical_teams
  where main_surgeon_id = p_surgeon and status = 'ACTIVE';
$$;

create or replace function public.count_associated_doctors(p_team uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.team_members
  where team_id = p_team and role_in_team = 'ASSOCIATED_DOCTOR' and status = 'ACTIVE';
$$;

grant execute on function public.count_active_teams_by_surgeon(uuid) to authenticated;
grant execute on function public.count_associated_doctors(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) RPC: cirurgião cria a PRÓPRIA equipe. Valida papel + limite de 5, gera o
--    team_number (próximo livre, com retry em corrida) e fixa main_surgeon_id =
--    auth.uid() (o cirurgião nunca escolhe outro responsável).
--    Erros padronizados: FORBIDDEN, TEAM_LIMIT_REACHED.
-- ----------------------------------------------------------------------------
create or replace function public.surgeon_create_team()
returns public.medical_teams
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.user_role;
  v_num  int;
  v_team public.medical_teams;
  v_try  int := 0;
begin
  select role into v_role from public.profiles where id = v_uid;
  if not (public.is_admin() or v_role = 'MAIN_SURGEON') then
    raise exception 'FORBIDDEN';
  end if;

  if public.count_active_teams_by_surgeon(v_uid) >= 5 then
    raise exception 'TEAM_LIMIT_REACHED';
  end if;

  loop
    v_try := v_try + 1;
    select coalesce(max(team_number), 0) + 1 into v_num from public.medical_teams;
    begin
      insert into public.medical_teams (team_number, main_surgeon_id, status)
      values (v_num, v_uid, 'ACTIVE')
      returning * into v_team;
      return v_team;
    exception when unique_violation then
      if v_try >= 25 then raise; end if;  -- corrida no team_number: tenta o próximo
    end;
  end loop;
end;
$$;
grant execute on function public.surgeon_create_team() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Limite de 10 associados ATIVOS por equipe — trigger BEFORE INSERT/UPDATE em
--    team_members (cobre inclusão e reativação). Erro: TEAM_DOCTOR_LIMIT_REACHED.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_team_doctor_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.role_in_team = 'ASSOCIATED_DOCTOR' and NEW.status = 'ACTIVE'
     and (TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and OLD.status is distinct from 'ACTIVE')) then
    if public.count_associated_doctors(NEW.team_id) >= 10 then
      raise exception 'TEAM_DOCTOR_LIMIT_REACHED';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_team_doctor_limit on public.team_members;
create trigger trg_team_doctor_limit before insert or update on public.team_members
  for each row execute function public.enforce_team_doctor_limit();

-- ----------------------------------------------------------------------------
-- 4) RLS: o cirurgião pode ATUALIZAR (editar/arquivar) a PRÓPRIA equipe.
--    (teams_admin da 0001 já cobre o ADMIN para tudo.)
-- ----------------------------------------------------------------------------
drop policy if exists teams_surgeon_update on public.medical_teams;
create policy teams_surgeon_update on public.medical_teams for update to authenticated
  using (public.is_admin() or public.is_main_surgeon_of(id))
  with check (public.is_admin() or public.is_main_surgeon_of(id));

-- main_surgeon_id é IMUTÁVEL para não-admin (o cirurgião não se remove nem passa
-- a responsabilidade). Erro: CANNOT_REMOVE_MAIN_SURGEON.
create or replace function public.protect_team_main_surgeon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and NEW.main_surgeon_id is distinct from OLD.main_surgeon_id then
    raise exception 'CANNOT_REMOVE_MAIN_SURGEON';
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_protect_team_main_surgeon on public.medical_teams;
create trigger trg_protect_team_main_surgeon before update on public.medical_teams
  for each row execute function public.protect_team_main_surgeon();

-- Segurança extra: nunca remover (por team_members) quem é o responsável da equipe.
create or replace function public.protect_main_surgeon_membership()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_main uuid;
begin
  select main_surgeon_id into v_main from public.medical_teams where id = OLD.team_id;
  if OLD.doctor_id is not distinct from v_main then
    raise exception 'CANNOT_REMOVE_MAIN_SURGEON';
  end if;
  return OLD;
end;
$$;
drop trigger if exists trg_protect_main_surgeon_member on public.team_members;
create trigger trg_protect_main_surgeon_member before delete on public.team_members
  for each row execute function public.protect_main_surgeon_membership();

-- ----------------------------------------------------------------------------
-- 5) Convite por cirurgião: estende create_professional_invite para permitir o
--    MAIN_SURGEON convidar um ASSOCIATED_DOCTOR para a PRÓPRIA equipe. Mantém
--    admin/suporte e a expiração/uso único (uma versão única por e-mail).
--    (Superset — esta é a maior migration desta função, então prevalece.)
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
  if p_role not in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
    raise exception 'Papel inválido para convite.';
  end if;

  -- Permissão: admin/suporte OU o cirurgião da própria equipe (só p/ associado).
  if public.is_admin() or public.is_support() then
    null;
  elsif p_role = 'ASSOCIATED_DOCTOR' and p_team_id is not null and public.is_main_surgeon_of(p_team_id) then
    null;
  else
    raise exception 'Sem permissão para gerar convites.';
  end if;

  -- Um convite ATIVO por e-mail (expira anteriores não usados do mesmo e-mail).
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

-- RLS prof_invites: além de admin/suporte, o cirurgião lê/cria convites das
-- equipes dele (a RPC é SECURITY DEFINER, mas isto cobre leituras diretas).
drop policy if exists prof_invites_admin_support on public.professional_invites;
create policy prof_invites_admin_support on public.professional_invites for all to authenticated
  using (public.is_admin() or public.is_support() or (team_id is not null and public.is_main_surgeon_of(team_id)))
  with check (public.is_admin() or public.is_support() or (team_id is not null and public.is_main_surgeon_of(team_id)));
