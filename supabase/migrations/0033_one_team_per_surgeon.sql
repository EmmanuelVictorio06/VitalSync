-- ============================================================================
-- VitalSync — Cirurgião tem no máximo UMA equipe ativa (antes: 5)
--
-- 1) surgeon_create_team(): recriada com o corpo VIVO (o da 0031, que já usa
--    o papel MEDICAL_SURGEON), trocando SOMENTE o teto 5 → 1. Mantém o retry
--    de corrida do team_number; o grant da 0028 é preservado pelo OR REPLACE.
-- 2) Trigger enforce_one_team_per_surgeon em medical_teams: garante o teto
--    também nos caminhos que NÃO passam pela RPC:
--      • criação direta pelo ADMIN (insert sob a policy teams_admin);
--      • reativação (UPDATE de status INACTIVE→ACTIVE);
--      • troca de responsável (UPDATE de main_surgeon_id), inclusive via
--        admin_replace_main_surgeon — o UPDATE da RPC dispara este trigger.
--
-- PRÉ-CHECAGEM (rodar ANTES de aplicar; deve retornar 0 linhas — se retornar
-- algo, há cirurgião com 2+ equipes ativas e é preciso consolidar antes):
--   select main_surgeon_id, count(*) from public.medical_teams
--   where status = 'ACTIVE' group by 1 having count(*) > 1;
--
-- Espelho no frontend: frontend/src/lib/teamLimits.ts (maxTeamsPerSurgeon: 1).
-- ADITIVA e IDEMPOTENTE. Não edita migrations anteriores (0001…0032).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) RPC do cirurgião: teto de 1 equipe ativa.
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
  if not (public.is_admin() or v_role = 'MEDICAL_SURGEON') then
    raise exception 'FORBIDDEN';
  end if;

  if public.count_active_teams_by_surgeon(v_uid) >= 1 then
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
      if v_try >= 25 then raise; end if;
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) Teto de 1 equipe ativa por cirurgião garantido NO BANCO para todos os
--    caminhos de escrita em medical_teams. Erro: TEAM_LIMIT_REACHED.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_one_team_per_surgeon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Só interessa quando a linha resultante é uma equipe ATIVA com responsável.
  if new.main_surgeon_id is null or new.status <> 'ACTIVE' then
    return new;
  end if;

  -- UPDATE que não abre vaga nova (equipe já ativa, mesmo responsável — ex.:
  -- trocar team_number) passa direto; senão a própria linha contaria contra si.
  if TG_OP = 'UPDATE'
     and old.status = 'ACTIVE'
     and new.main_surgeon_id = old.main_surgeon_id then
    return new;
  end if;

  -- INSERT, reativação (INACTIVE→ACTIVE) ou troca de responsável: o novo
  -- responsável não pode já ter uma equipe ativa (a linha atual ainda não
  -- conta — BEFORE trigger / valor antigo na tabela).
  if public.count_active_teams_by_surgeon(new.main_surgeon_id) >= 1 then
    raise exception 'TEAM_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_one_team_per_surgeon on public.medical_teams;
create trigger trg_one_team_per_surgeon
  before insert or update on public.medical_teams
  for each row execute function public.enforce_one_team_per_surgeon();
