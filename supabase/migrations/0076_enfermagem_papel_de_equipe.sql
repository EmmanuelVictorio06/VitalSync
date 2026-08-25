-- ============================================================================
-- Migration: 0076_enfermagem_papel_de_equipe
--
-- Enfermagem vira papel de PRIMEIRA CLASSE dentro da equipe.
--
-- O PROBLEMA QUE ESTA MIGRATION RESOLVE: o enum `role_in_team` ganhou o valor
-- 'NURSING_PROFESSIONAL' na 0054, mas DUAS check constraints continuaram
-- barrando o valor na prática:
--   • team_members_assoc_only_chk       (0026 — NOT VALID, mas ativa p/ INSERT)
--   • team_members_role_associate_only  (0030 — VALID)
-- Por causa disso o enfermeiro do piloto foi inserido como 'ASSOCIATED_DOCTOR'
-- (gambiarra documentada em supabase/_scripts/func2_enfermeiro_piloto_por_equipe.sql,
-- bloco 2). Enquanto NADA lia `role_in_team`, a dívida era barata. A 0077 passa
-- a ROTEAR o alerta amarelo por `role_in_team = 'NURSING_PROFESSIONAL'` — a
-- partir dali a gambiarra vira bug: o enfermeiro contaria como médico e o
-- amarelo iria para a fila errada. Por isso a constraint é relaxada AQUI, numa
-- migration separada e anterior ao roteamento.
--
-- M-12 PRESERVADO: 'MAIN_SURGEON' continua barrado. O cirurgião responsável
-- mora em `medical_teams.main_surgeon_id` (1 por equipe) e nunca em
-- `team_members` — era esse o objetivo original das constraints de 0026/0030,
-- e ele não é afetado. O que muda é só a admissão da enfermagem.
--
-- LIMITE DE 10 ASSOCIADOS: `count_associated_doctors` (0028) filtra
-- `role_in_team = 'ASSOCIATED_DOCTOR'`, então enfermeiro NÃO consome vaga de
-- médico associado — e o efeito colateral que o script do piloto aceitava
-- ("consome 1 das 10 vagas") desaparece junto com a gambiarra. Não há teto de
-- enfermeiros por equipe: o requisito é explicitamente "um ou mais".
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0075.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Constraint: team_members aceita médico associado OU enfermagem.
--    Drop das duas antigas + uma única constraint nova com o conjunto completo
--    de valores permitidos (não dá para "estender" um CHECK in place).
-- ----------------------------------------------------------------------------
alter table public.team_members drop constraint if exists team_members_assoc_only_chk;
alter table public.team_members drop constraint if exists team_members_role_associate_only;

do $$ begin
  alter table public.team_members
    add constraint team_members_role_allowed_chk
    check (role_in_team::text in ('ASSOCIATED_DOCTOR', 'NURSING_PROFESSIONAL'));
exception when duplicate_object then null; end $$;

comment on constraint team_members_role_allowed_chk on public.team_members is
  'team_members guarda médicos associados e profissionais de enfermagem. MAIN_SURGEON segue proibido (M-12): o cirurgião responsável mora em medical_teams.main_surgeon_id.';

-- ----------------------------------------------------------------------------
-- 2) Migração de dados: desfaz a gambiarra do piloto.
--    Quem é enfermeiro em `profiles.role` mas está gravado como
--    'ASSOCIATED_DOCTOR' no vínculo passa a ter o papel correto. O critério é a
--    fonte de verdade do papel (`profiles.role`), não o nome nem a data.
-- ----------------------------------------------------------------------------
do $$
declare v_migradas int;
begin
  update public.team_members m
     set role_in_team = 'NURSING_PROFESSIONAL'
    from public.profiles p
   where p.id = m.doctor_id
     and p.role::text = 'NURSING_PROFESSIONAL'
     and m.role_in_team::text = 'ASSOCIATED_DOCTOR';

  get diagnostics v_migradas = row_count;

  if v_migradas > 0 then
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'TEAM_MEMBER_ROLE_FIXED',
            v_migradas || ' vínculo(s) de enfermagem corrigido(s) de ASSOCIATED_DOCTOR para NURSING_PROFESSIONAL (0076)');
    raise notice '0076: % vínculo(s) de enfermagem corrigido(s).', v_migradas;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) Aviso "você foi adicionado à equipe" passa a valer para a enfermagem.
--    `after_team_member_added` (0030) só disparava para ASSOCIATED_DOCTOR — o
--    script do piloto contava com esse aviso justamente porque o enfermeiro
--    entrava disfarçado de associado. Sem esta extensão, corrigir o papel
--    silenciaria a notificação. Mesma assinatura da 0030 → create or replace.
-- ----------------------------------------------------------------------------
create or replace function public.after_team_member_added()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.role_in_team::text in ('ASSOCIATED_DOCTOR', 'NURSING_PROFESSIONAL')
     and NEW.status = 'ACTIVE' then
    perform public.notify_team_membership_added(NEW.team_id, NEW.doctor_id);
  end if;
  return NEW;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Helper de leitura: enfermeiros ATIVOS de uma equipe.
--    Usado pelo roteamento da 0077 e pela tela de gestão de equipes. Fica aqui
--    porque é derivado só do vínculo — a 0077 cuida do roteamento em si.
--    `profiles.status` também é checado: vínculo ativo de conta desativada não
--    conta como destinatário.
-- ----------------------------------------------------------------------------
create or replace function public.team_active_nurses(p_team uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.doctor_id
    from public.team_members m
    join public.profiles pr on pr.id = m.doctor_id
   where m.team_id = p_team
     and m.status = 'ACTIVE'
     and m.role_in_team::text = 'NURSING_PROFESSIONAL'
     and pr.status = 'ACTIVE';
$$;

comment on function public.team_active_nurses(uuid) is
  'Profissionais de enfermagem ATIVOS vinculados à equipe (vínculo ativo + conta ativa). Fronteira de escopo por EQUIPE — o pool por hospital é a outra via (is_nurse_for_patient, 0065).';

revoke execute on function public.team_active_nurses(uuid) from public, anon;
grant  execute on function public.team_active_nurses(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Índice de apoio ao roteamento por papel (a 0077 filtra por role_in_team).
-- ----------------------------------------------------------------------------
create index if not exists idx_team_members_nurses
  on public.team_members(team_id)
  where status = 'ACTIVE' and role_in_team = 'NURSING_PROFESSIONAL';

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- 1. a constraint aceita enfermagem e continua barrando MAIN_SURGEON:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.team_members'::regclass and contype = 'c';
--   --> só team_members_role_allowed_chk, com os DOIS valores.
--
--   -- 2. nenhum enfermeiro sobrou disfarçado de médico associado:
--   select m.team_id, m.doctor_id, m.role_in_team, p.role
--     from public.team_members m join public.profiles p on p.id = m.doctor_id
--    where p.role::text = 'NURSING_PROFESSIONAL';
--   --> role_in_team deve ser 'NURSING_PROFESSIONAL' em todas as linhas.
--
--   -- 3. o teto de 10 associados ignora a enfermagem:
--   select public.count_associated_doctors('<EQUIPE>');
--
--   -- 4. helper responde:
--   select * from public.team_active_nurses('<EQUIPE>');
-- ----------------------------------------------------------------------------
