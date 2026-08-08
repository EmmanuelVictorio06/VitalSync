-- ============================================================================
-- Migration: 0065_enfermagem_pool_plantao  (Triagem de Enfermagem — Fase 1.1/1.2)
--
-- Modela POOL e PLANTÃO da enfermagem. O pool é a fronteira de escopo E a
-- fronteira contratual: hoje ele é um único pool cobrindo todos os hospitais
-- (comportamento idêntico ao "pool global" pedido), mas quando um hospital
-- exigir equipe dedicada não é preciso refazer RLS — basta criar outro pool.
-- Para a LGPD, o pool é o que delimita a que hospitais um enfermeiro alcança
-- (hospital = controlador, VitalSync = operador).
--
-- "LIVRE" É CALCULADO, NUNCA DECLARADO. Um toggle manual mente (a pessoa
-- esquece ligado e some da distribuição). Livre =
--   está em plantão  E  não pausou  E  carga ativa < wipLimit
-- Ver `nurse_is_free()`.
--
-- DESVIO DELIBERADO DA SPEC (§4.1 → aqui): as colunas de ATRIBUIÇÃO
-- (`assigned_nurse_id`, `assigned_at`, `offer_expires_at`) entram nesta
-- migration, e não na 0068. Motivo: `nurse_active_load()` — que é parte do
-- modelo de disponibilidade da Fase 1 — lê `assigned_nurse_id`; e no modo
-- MANUAL (feature flag desligada, que é como a primeira coorte roda) o
-- enfermeiro já assume alertas da fila aberta, o que também grava atribuição.
-- A 0068 acrescenta só o COMPORTAMENTO (oferta automática, expiração, SLA).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0064.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Pool: quem cobre quais hospitais.
-- ----------------------------------------------------------------------------
create table if not exists public.nurse_pools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.nurse_pool_hospitals (
  pool_id     uuid not null references public.nurse_pools(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (pool_id, hospital_id)
);

create table if not exists public.nurse_pool_members (
  pool_id    uuid not null references public.nurse_pools(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (pool_id, profile_id)
);

create index if not exists idx_nurse_pool_members_profile on public.nurse_pool_members(profile_id) where is_active;
create index if not exists idx_nurse_pool_hospitals_hospital on public.nurse_pool_hospitals(hospital_id);

comment on table public.nurse_pools is
  'Pool de enfermagem: fronteira de escopo (quais hospitais os enfermeiros do pool alcançam) e fronteira contratual para a LGPD.';

-- ----------------------------------------------------------------------------
-- 2) Plantão. `paused_at` é a pausa curta (almoço/banheiro) — NÃO encerra o
--    turno; `ends_at` é o fim do turno.
-- ----------------------------------------------------------------------------
create table if not exists public.nurse_shifts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pool_id    uuid not null references public.nurse_pools(id) on delete cascade,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  paused_at  timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_nurse_shifts_ativo
  on public.nurse_shifts(profile_id, starts_at desc) where ends_at is null;

comment on column public.nurse_shifts.paused_at is
  'Pausa curta (almoço/banheiro): suspende as ofertas sem encerrar o turno. Null = ativo.';

-- ----------------------------------------------------------------------------
-- 3) Colunas de ATRIBUIÇÃO em clinical_alerts.
--    Atribuição ≠ lock: atribuição = "este alerta é seu para triar"
--    (preferência, visível a todo o pool); lock (`in_analysis_by`, 0044) =
--    "estou atendendo agora" (exclusividade). Os dois coexistem.
-- ----------------------------------------------------------------------------
alter table public.clinical_alerts
  add column if not exists assigned_nurse_id uuid references public.profiles(id),
  add column if not exists assigned_at       timestamptz,
  add column if not exists offer_expires_at  timestamptz;

comment on column public.clinical_alerts.assigned_nurse_id is
  'Enfermeiro a quem o alerta foi OFERECIDO (dono preferencial). Não esconde o alerta dos demais do pool — ver 0068.';
comment on column public.clinical_alerts.offer_expires_at is
  'Fim da janela da oferta. Vencida sem aceite, o alerta cai para a fila aberta.';

create index if not exists idx_alerts_assigned_nurse
  on public.clinical_alerts(assigned_nurse_id) where assigned_nurse_id is not null;

-- ----------------------------------------------------------------------------
-- 4) Helpers de disponibilidade.
-- ----------------------------------------------------------------------------

/** true se o profile é Profissional de Enfermagem ATIVO. */
create or replace function public.is_nurse(p_profile uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_profile
       and p.role::text = 'NURSING_PROFESSIONAL'
       and p.status = 'ACTIVE'
  );
$$;

/** Turno aberto agora e não pausado. */
create or replace function public.is_nurse_on_duty(p_profile uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_nurse(p_profile) and exists (
    select 1 from public.nurse_shifts s
     where s.profile_id = p_profile
       and s.starts_at <= now()
       and s.ends_at is null
       and s.paused_at is null
  );
$$;

/**
 * Carga ativa: alertas atribuídos ao enfermeiro que ainda não foram
 * finalizados. É o numerador do "3/5" exibido na barra de plantão.
 */
create or replace function public.nurse_active_load(p_profile uuid default auth.uid())
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.clinical_alerts a
   where a.assigned_nurse_id = p_profile
     and a.attendance_status not in ('ATTENDED', 'IGNORED')
     and a.attended = false
     and a.escalated_at is null;
$$;

/** LIVRE = em plantão, não pausado e abaixo do limite de WIP. */
create or replace function public.nurse_is_free(p_profile uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_nurse_on_duty(p_profile)
     and public.nurse_active_load(p_profile) < public.nursing_setting_num('wipLimit', 5)::int;
$$;

/**
 * Escopo de leitura da enfermagem: o usuário é enfermeiro ativo, membro de um
 * pool ATIVO cujo `nurse_pool_hospitals` cobre o hospital daquele paciente.
 *
 * FAIL-CLOSED: paciente sem `hospital_id` não é coberto por nenhum pool — o
 * acesso continua sendo só o de equipe. É a escolha conservadora para dado de
 * saúde (LGPD art. 11).
 *
 * Não exige plantão aberto: o enfermeiro precisa conseguir revisar o histórico
 * do que atendeu fora do turno. O que o plantão governa é receber OFERTA.
 */
create or replace function public.is_nurse_for_patient(p_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.patients pat
      join public.nurse_pool_hospitals nph on nph.hospital_id = pat.hospital_id
      join public.nurse_pools pool         on pool.id = nph.pool_id and pool.is_active
      join public.nurse_pool_members m     on m.pool_id = pool.id and m.is_active
     where pat.id = p_patient
       and pat.hospital_id is not null
       and m.profile_id = auth.uid()
       and public.is_nurse(auth.uid())
  );
$$;

grant execute on function public.is_nurse(uuid)              to authenticated;
grant execute on function public.is_nurse_on_duty(uuid)      to authenticated;
grant execute on function public.nurse_active_load(uuid)     to authenticated;
grant execute on function public.nurse_is_free(uuid)         to authenticated;
grant execute on function public.is_nurse_for_patient(uuid)  to authenticated;

-- ----------------------------------------------------------------------------
-- 5) RLS das tabelas novas. Admin administra; o enfermeiro lê o próprio pool e
--    gerencia o próprio turno (nunca o de outro).
-- ----------------------------------------------------------------------------
alter table public.nurse_pools           enable row level security;
alter table public.nurse_pool_hospitals  enable row level security;
alter table public.nurse_pool_members    enable row level security;
alter table public.nurse_shifts          enable row level security;

drop policy if exists nurse_pools_read on public.nurse_pools;
create policy nurse_pools_read on public.nurse_pools for select to authenticated using (true);
drop policy if exists nurse_pools_admin on public.nurse_pools;
create policy nurse_pools_admin on public.nurse_pools for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists nurse_pool_hospitals_read on public.nurse_pool_hospitals;
create policy nurse_pool_hospitals_read on public.nurse_pool_hospitals for select to authenticated using (true);
drop policy if exists nurse_pool_hospitals_admin on public.nurse_pool_hospitals;
create policy nurse_pool_hospitals_admin on public.nurse_pool_hospitals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists nurse_pool_members_read on public.nurse_pool_members;
create policy nurse_pool_members_read on public.nurse_pool_members for select to authenticated using (true);
drop policy if exists nurse_pool_members_admin on public.nurse_pool_members;
create policy nurse_pool_members_admin on public.nurse_pool_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Turnos: o pool inteiro precisa enxergar quem está de plantão (a fila mostra
-- "aguardando Fulano"); escrever, só no próprio turno (ou Admin).
drop policy if exists nurse_shifts_read on public.nurse_shifts;
create policy nurse_shifts_read on public.nurse_shifts for select to authenticated using (true);
drop policy if exists nurse_shifts_self on public.nurse_shifts;
create policy nurse_shifts_self on public.nurse_shifts for all to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

-- ----------------------------------------------------------------------------
-- 6) RPCs de plantão (o app nunca escreve direto em nurse_shifts).
-- ----------------------------------------------------------------------------

/** Pool ativo que cobre um hospital (o primeiro, se houver mais de um). */
create or replace function public.nurse_pool_for_hospital(p_hospital uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select nph.pool_id
    from public.nurse_pool_hospitals nph
    join public.nurse_pools pool on pool.id = nph.pool_id and pool.is_active
   where nph.hospital_id = p_hospital
   limit 1;
$$;

/** Abre (ou reaproveita) o turno do enfermeiro logado. */
create or replace function public.nurse_open_shift(p_pool uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pool uuid; v_shift uuid;
begin
  if not public.is_nurse(auth.uid()) then
    raise exception 'Apenas o Profissional de Enfermagem abre plantão.';
  end if;

  -- Já existe turno aberto? Reaproveita (e desfaz a pausa, se houver).
  select id into v_shift from public.nurse_shifts
   where profile_id = auth.uid() and ends_at is null
   order by starts_at desc limit 1;
  if found then
    update public.nurse_shifts set paused_at = null where id = v_shift;
    return v_shift;
  end if;

  v_pool := coalesce(
    p_pool,
    (select m.pool_id from public.nurse_pool_members m
      join public.nurse_pools pool on pool.id = m.pool_id and pool.is_active
     where m.profile_id = auth.uid() and m.is_active limit 1)
  );
  if v_pool is null then
    raise exception 'Você ainda não faz parte de nenhum pool de enfermagem. Peça ao administrador para incluí-lo.';
  end if;

  insert into public.nurse_shifts (profile_id, pool_id) values (auth.uid(), v_pool)
  returning id into v_shift;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  select p.name, p.role::text, 'NURSE_SHIFT_OPEN', 'Plantão de enfermagem'
    from public.profiles p where p.id = auth.uid();

  return v_shift;
end;
$$;

/** Pausa curta — continua de plantão, mas para de receber ofertas. */
create or replace function public.nurse_pause_shift()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.nurse_shifts set paused_at = now()
   where profile_id = auth.uid() and ends_at is null and paused_at is null;
  if not found then raise exception 'Você não tem plantão aberto para pausar.'; end if;
end;
$$;

/** Retoma o plantão pausado. */
create or replace function public.nurse_resume_shift()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.nurse_shifts set paused_at = null
   where profile_id = auth.uid() and ends_at is null and paused_at is not null;
  if not found then raise exception 'Você não tem plantão pausado.'; end if;
end;
$$;

/** Encerra o turno. */
create or replace function public.nurse_close_shift()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.nurse_shifts set ends_at = now(), paused_at = null
   where profile_id = auth.uid() and ends_at is null;
  if not found then raise exception 'Você não tem plantão aberto.'; end if;

  insert into public.audit_logs (actor_name, actor_role, action, entity)
  select p.name, p.role::text, 'NURSE_SHIFT_CLOSE', 'Plantão de enfermagem'
    from public.profiles p where p.id = auth.uid();
end;
$$;

/** Estado do plantão para a barra do dashboard (turno, carga, limite). */
create or replace function public.nurse_my_shift()
returns table(
  shift_id     uuid,
  pool_id      uuid,
  pool_name    text,
  starts_at    timestamptz,
  paused_at    timestamptz,
  on_duty      boolean,
  active_load  int,
  wip_limit    int,
  is_free      boolean
) language sql stable security definer set search_path = public as $$
  select s.id, s.pool_id, pool.name, s.starts_at, s.paused_at,
         public.is_nurse_on_duty(auth.uid()),
         public.nurse_active_load(auth.uid()),
         public.nursing_setting_num('wipLimit', 5)::int,
         public.nurse_is_free(auth.uid())
    from public.nurse_shifts s
    join public.nurse_pools pool on pool.id = s.pool_id
   where s.profile_id = auth.uid() and s.ends_at is null
   order by s.starts_at desc
   limit 1;
$$;

grant execute on function public.nurse_pool_for_hospital(uuid) to authenticated;
grant execute on function public.nurse_open_shift(uuid)        to authenticated;
grant execute on function public.nurse_pause_shift()           to authenticated;
grant execute on function public.nurse_resume_shift()          to authenticated;
grant execute on function public.nurse_close_shift()           to authenticated;
grant execute on function public.nurse_my_shift()              to authenticated;

-- ----------------------------------------------------------------------------
-- 7) Seed: um pool único cobrindo TODOS os hospitais — comportamento idêntico
--    ao "pool global" pedido, com a estrutura pronta para segmentar depois.
--    Hospitais criados no futuro precisam ser vinculados (o painel do Admin faz
--    isso; enquanto não houver tela, o INSERT abaixo pode ser reexecutado).
-- ----------------------------------------------------------------------------
insert into public.nurse_pools (name)
select 'Pool Geral de Enfermagem'
 where not exists (select 1 from public.nurse_pools);

insert into public.nurse_pool_hospitals (pool_id, hospital_id)
select pool.id, h.id
  from public.nurse_pools pool
  cross join public.hospitals h
 where pool.name = 'Pool Geral de Enfermagem'
on conflict (pool_id, hospital_id) do nothing;

-- Todo enfermeiro ativo já entra no pool geral (idempotente).
insert into public.nurse_pool_members (pool_id, profile_id)
select pool.id, p.id
  from public.nurse_pools pool
  cross join public.profiles p
 where pool.name = 'Pool Geral de Enfermagem'
   and p.role::text = 'NURSING_PROFESSIONAL'
   and p.status = 'ACTIVE'
on conflict (pool_id, profile_id) do nothing;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   select name, (select count(*) from public.nurse_pool_hospitals h where h.pool_id = p.id) as hospitais,
--          (select count(*) from public.nurse_pool_members m where m.pool_id = p.id) as enfermeiros
--     from public.nurse_pools p;
--
--   -- logado como enfermeiro:
--   select public.nurse_open_shift();
--   select * from public.nurse_my_shift();            -- on_duty=true, is_free=true, active_load=0
--   select public.nurse_pause_shift();
--   select public.is_nurse_on_duty();                  -- false (pausado)
--   select public.nurse_resume_shift();
--   select public.is_nurse_for_patient('<paciente do hospital coberto>');  -- true
-- ----------------------------------------------------------------------------
