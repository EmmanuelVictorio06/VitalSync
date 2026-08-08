-- ============================================================================
-- Migration: 0063_ttl_lock_atendimento  (Triagem de Enfermagem — Fase 0.1)
--
-- BUG CORRIGIDO: o lock de atendimento da 0044 (`in_analysis_by`/
-- `in_analysis_at`) nunca expirava. Um profissional que colocava um alerta em
-- análise e fechava o navegador deixava o alerta preso em IN_ANALYSIS para
-- sempre — `alert_release_analysis` só existe como ação MANUAL, e a UI não a
-- oferece a quem não é o dono do lock. Nenhuma migration até a 0062 tinha
-- qualquer expiração de `in_analysis_at` (verificado).
--
-- Vale para TODOS os papéis (médico, associado, enfermagem), não só para a
-- triagem de enfermagem que motivou a correção.
--
-- Também cria a seção `nursing` em `app_settings` com os parâmetros
-- operacionais da triagem (janelas, limites, flags) e os leitores tipados que
-- as migrations 0064–0068 reaproveitam — nada de número mágico espalhado.
--
-- PRÉ-REQUISITO do agendamento: extensão pg_cron (mesma ressalva de permissão
-- da 0038/0061 — se o `db push` não puder habilitar, use o Dashboard e rode a
-- migration de novo).
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados. Rode após a 0062.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Parâmetros operacionais da triagem (app_settings, seção `nursing`).
--    Defaults propostos no PR — confirmar com o Emmanuel antes da coorte real
--    (ver docs/PONTOS_PENDENTES.md).
-- ----------------------------------------------------------------------------
insert into public.app_settings (section, data)
values (
  'nursing',
  jsonb_build_object(
    'lockTtlMinutes',            15,   -- TTL do lock de atendimento (esta migration)
    'offerWindowMinutes',         5,   -- janela da oferta a um enfermeiro (0068)
    'wipLimit',                   5,   -- máximo de alertas ativos por enfermeiro (0065)
    'slaYellowMinutes',          60,   -- amarelo em fila aberta vira prioridade (0068)
    'slaMaxHours',                8,   -- amarelo além disso escala sozinho (0068)
    'escalationFallbackMinutes', 30,   -- médico não assumiu o escalado (0064)
    'reviewSamplingPct',         10,   -- amostragem de revisão de amarelos (0068)
    'autoRouting',            false    -- feature flag da distribuição automática (0068)
  )
)
on conflict (section) do nothing;

/**
 * Lê um número da seção `nursing`, caindo no default quando ausente.
 * SECURITY DEFINER porque `app_settings` é admin-only por RLS e estas funções
 * rodam também no contexto do pg_cron (sem `auth.uid()`).
 */
create or replace function public.nursing_setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (s.data ->> p_key)::numeric from public.app_settings s where s.section = 'nursing'),
    p_default
  );
$$;

/** Lê um booleano da seção `nursing` (usado pela feature flag da 0068). */
create or replace function public.nursing_setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (s.data ->> p_key)::boolean from public.app_settings s where s.section = 'nursing'),
    p_default
  );
$$;

grant execute on function public.nursing_setting_num(text, numeric)  to authenticated;
grant execute on function public.nursing_setting_bool(text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) release_stale_alert_locks — devolve à fila os alertas travados há mais
--    tempo que o TTL. Um único UPDATE ... RETURNING alimenta a timeline, para
--    que liberação e registro sejam atômicos.
--
--    `attendance_confirmations.attended_by` é NOT NULL (0001), então o autor do
--    evento é o DONO do lock que expirou — a leitura correta da timeline é
--    "o lock de Fulano expirou", não "o sistema atendeu".
-- ----------------------------------------------------------------------------
create or replace function public.release_stale_alert_locks()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ttl   int := public.nursing_setting_num('lockTtlMinutes', 15)::int;
  v_count int := 0;
begin
  with liberados as (
    update public.clinical_alerts a
       set attendance_status = 'PENDING',
           in_analysis_by    = null,
           in_analysis_at    = null,
           updated_at        = now()
     where a.attendance_status = 'IN_ANALYSIS'
       and a.in_analysis_by is not null
       and a.in_analysis_at < now() - make_interval(mins => v_ttl)
    returning a.id, a.patient_id, a.in_analysis_by as dono_anterior
  )
  insert into public.attendance_confirmations (patient_id, alert_id, attended_by, status, observation)
  select l.patient_id, l.id, l.dono_anterior, 'RELEASED',
         'Liberado automaticamente: análise sem conclusão há mais de ' || v_ttl || ' minutos.'
    from liberados l;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    -- Auditoria com ator "Sistema": no pg_cron não há auth.uid(), então
    -- audit_alert_action() registraria um ator vazio.
    insert into public.audit_logs (actor_name, actor_role, action, entity)
    values ('Sistema', 'SYSTEM', 'ALERT_LOCK_EXPIRED',
            v_count || ' alerta(s) devolvido(s) à fila por expiração do lock');
  end if;

  return v_count;
end;
$$;

comment on function public.release_stale_alert_locks() is
  'Devolve à fila (PENDING) alertas presos em IN_ANALYSIS além do TTL (app_settings.nursing.lockTtlMinutes). Vale para todos os papéis.';

-- Só o Admin dispara manualmente pelo app; o caminho normal é o pg_cron.
revoke execute on function public.release_stale_alert_locks() from public;
grant  execute on function public.release_stale_alert_locks() to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Agendamento a cada 5 minutos (idempotente: remove antes de recriar,
--    mesmo padrão da 0038/0061).
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when insufficient_privilege then
  raise warning 'pg_cron não pôde ser habilitado automaticamente (permissão insuficiente). Habilite pelo Dashboard → Database → Extensions e rode esta migration novamente.';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'release-stale-alert-locks';
    perform cron.schedule(
      'release-stale-alert-locks',
      '*/5 * * * *',
      $sql$select public.release_stale_alert_locks();$sql$
    );
  else
    raise warning 'pg_cron indisponível — o TTL do lock NÃO será aplicado automaticamente. Habilite a extensão e rode esta migration novamente.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO (rode após aplicar):
--
--   -- 1) trave um alerta e force o vencimento:
--   update public.clinical_alerts
--      set attendance_status='IN_ANALYSIS', in_analysis_by='<profile>', in_analysis_at = now() - interval '20 minutes'
--    where id = '<alerta>';
--   select public.release_stale_alert_locks();          -- deve devolver 1
--   select attendance_status, in_analysis_by from public.clinical_alerts where id = '<alerta>';  -- PENDING / null
--   select status, observation from public.attendance_confirmations where alert_id = '<alerta>' order by created_at desc limit 1;
--
--   -- 2) um lock recente NÃO pode ser liberado:
--   update public.clinical_alerts set in_analysis_at = now() where id = '<alerta>';
--   select public.release_stale_alert_locks();          -- deve devolver 0
--
--   -- 3) job agendado:
--   select jobname, schedule from cron.job where jobname = 'release-stale-alert-locks';
-- ----------------------------------------------------------------------------
