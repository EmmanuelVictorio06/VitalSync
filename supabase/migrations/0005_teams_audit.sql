-- ============================================================================
-- VitalSync — Auditoria das ações de Gerenciar Equipes (Admin)
--
-- Registra na trilha `audit_logs` (criada em 0003) as ações administrativas
-- sobre equipes: criar, editar, ativar, inativar, excluir, e adicionar/remover
-- médicos associados / trocar o cirurgião principal. O ator é o usuário logado
-- (auth.uid()) — Admin. Funções SECURITY DEFINER para escrever em audit_logs.
-- Rode no SQL Editor após 0001..0004.
-- ============================================================================

-- Auditoria de medical_teams (INSERT/UPDATE/DELETE).
create or replace function public.log_team_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text; v_action text; v_entity text; v_num int;
begin
  select p.name, p.role::text into v_name, v_role from public.profiles p where p.id = auth.uid();
  if v_name is null then v_name := 'Sistema'; v_role := '—'; end if;

  if TG_OP = 'INSERT' then
    v_num := NEW.team_number;
    v_action := 'TEAM_CREATE';
    v_entity := 'Equipe nº ' || lpad(v_num::text, 2, '0');
  elsif TG_OP = 'DELETE' then
    v_num := OLD.team_number;
    v_action := 'DELETE_OR_INACTIVATE';
    v_entity := 'Equipe nº ' || lpad(v_num::text, 2, '0') || ' — excluída';
  else -- UPDATE
    v_num := NEW.team_number;
    if NEW.status is distinct from OLD.status then
      if NEW.status = 'INACTIVE' then
        v_action := 'DELETE_OR_INACTIVATE';
        v_entity := 'Equipe nº ' || lpad(v_num::text, 2, '0') || ' — inativada';
      else
        v_action := 'TEAM_UPDATE';
        v_entity := 'Equipe nº ' || lpad(v_num::text, 2, '0') || ' — ativada';
      end if;
    elsif NEW.main_surgeon_id is distinct from OLD.main_surgeon_id then
      v_action := 'TEAM_UPDATE';
      v_entity := 'Equipe nº ' || lpad(v_num::text, 2, '0') || ' — cirurgião principal alterado';
    else
      v_action := 'TEAM_UPDATE';
      v_entity := 'Equipe nº ' || lpad(v_num::text, 2, '0');
    end if;
  end if;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (coalesce(v_name, '—'), coalesce(v_role, '—'), v_action, v_entity);
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_audit_teams_ins on public.medical_teams;
create trigger trg_audit_teams_ins after insert on public.medical_teams
  for each row execute function public.log_team_audit();
drop trigger if exists trg_audit_teams_upd on public.medical_teams;
create trigger trg_audit_teams_upd after update on public.medical_teams
  for each row execute function public.log_team_audit();
drop trigger if exists trg_audit_teams_del on public.medical_teams;
create trigger trg_audit_teams_del after delete on public.medical_teams
  for each row execute function public.log_team_audit();

-- Auditoria de team_members (vínculo de médico associado).
create or replace function public.log_team_member_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text; v_action text; v_entity text;
  v_team int; v_doctor text; v_team_id uuid; v_doctor_id uuid;
begin
  select p.name, p.role::text into v_name, v_role from public.profiles p where p.id = auth.uid();
  if v_name is null then v_name := 'Sistema'; v_role := '—'; end if;

  v_team_id   := coalesce(NEW.team_id, OLD.team_id);
  v_doctor_id := coalesce(NEW.doctor_id, OLD.doctor_id);
  select team_number into v_team from public.medical_teams where id = v_team_id;
  select name        into v_doctor from public.profiles where id = v_doctor_id;

  if TG_OP = 'INSERT' then
    v_action := 'TEAM_UPDATE';
    v_entity := 'Equipe nº ' || lpad(coalesce(v_team, 0)::text, 2, '0') || ' — médico vinculado: ' || coalesce(v_doctor, '—');
  else -- DELETE
    v_action := 'TEAM_UPDATE';
    v_entity := 'Equipe nº ' || lpad(coalesce(v_team, 0)::text, 2, '0') || ' — médico removido: ' || coalesce(v_doctor, '—');
  end if;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  values (coalesce(v_name, '—'), coalesce(v_role, '—'), v_action, v_entity);
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_audit_members_ins on public.team_members;
create trigger trg_audit_members_ins after insert on public.team_members
  for each row execute function public.log_team_member_audit();
drop trigger if exists trg_audit_members_del on public.team_members;
create trigger trg_audit_members_del after delete on public.team_members
  for each row execute function public.log_team_member_audit();
