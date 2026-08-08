-- ============================================================================
-- Migration: 0075_revogar_execucao_anon
--
-- ACHADO A2 da matriz de autorização (supabase/_scripts/testes/02, casos
-- G08/G09): 35 RPCs estavam EXECUTÁVEIS pelo papel `anon`, e quatro funções
-- de manutenção rodavam sem NENHUMA guarda interna quando chamadas por anon
-- (release_stale_alert_locks, reoffer_expired_alerts,
-- enqueue_missed_measurement_alerts, retry_failed_notifications).
--
-- POR QUE A ARMADILHA DA 0022 É MAIS FUNDA DO QUE ESTAVA DOCUMENTADO:
-- não é (só) o EXECUTE default para PUBLIC. O Supabase configura
-- `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role` — toda função nova nasce com grant DIRETO para
-- anon. Um `revoke from public` (como o da 0063) não remove esse grant direto.
-- E `create or replace` com MUDANÇA DE ASSINATURA cria função nova com grants
-- novos: foi assim que `submit_vital_record` (18→21 args entre 0021 e 0053)
-- REGREDIU a revogação da 0022 — dava para chamá-la por anon com um token
-- válido, pulando a revalidação de CPF + rate-limit da Edge Function (o
-- controle C-04). Regra daqui em diante: TODA migration que criar/retipar
-- função sensível precisa revogar `anon` EXPLICITAMENTE, não só `public`.
--
-- Duas classes de correção:
--   (a) Funções de cron/manutenção — só o dono (postgres, via pg_cron) e o
--       service_role precisam executar. Revoga anon E authenticated. O
--       frontend não chama nenhuma delas (verificado por grep em
--       frontend/src — o reenvio manual do painel usa alert_resend_notification,
--       que tem guarda própria e chama notify_team_of_alert como definer).
--   (b) RPCs de usuário com guarda interna — a guarda segurou nos testes
--       (defesa em profundidade), mas anon não tem NENHUM motivo para
--       executá-las. Revoga anon; authenticated permanece.
--
-- ADITIVA e IDEMPOTENTE. Rode após a 0074.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (a) Manutenção/cron: nem anon, nem authenticated.
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'release_stale_alert_locks()',
    'check_unanswered_escalations()',
    'reoffer_expired_alerts()',
    'sample_yellow_for_review()',
    'offer_yellow_alert(uuid)',
    'notify_team_of_alert(uuid)',
    'notify_escalation_unanswered(uuid)',
    'enqueue_measurement_reminders(text)',
    'dispatch_measurement_reminders(text)',
    'enqueue_missed_measurement_alerts(text)',
    'dispatch_missed_measurement_alerts(text)',
    'retry_failed_notifications()',
    'alarm_exhausted_notifications()'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- (b) RPCs de usuário: anon fora; authenticated continua (guardas internas
--     seguem valendo — defesa em profundidade, não substituição).
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'admin_clear_test_data()',
    'admin_get_users_overview()',
    'alert_escalate_to_red(uuid, text)',
    'alert_ignore(uuid, text)',
    'alert_mark_attended(uuid, uuid, text)',
    'alert_register_contact(uuid, text)',
    'alert_release_analysis(uuid)',
    'alert_resend_notification(uuid)',
    'alert_set_in_analysis(uuid)',
    'homologation_set_mode(boolean)',
    'homologation_set_recipients(text[])',
    'homologation_stats()',
    'nurse_claim_alert(uuid)',
    'nurse_close_shift()',
    'nurse_decline_alert(uuid)',
    'nurse_my_shift()',
    'nurse_open_shift(uuid)',
    'nurse_pause_shift()',
    'nurse_resume_shift()',
    'soft_delete_patient(uuid)',
    'staff_insert_vital_record(uuid, text, numeric, int, int, int, int, int, int, int, int, boolean, int, boolean, boolean, boolean, boolean, int, boolean)',
    'log_patient_access(uuid, text)'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
  end loop;
exception when undefined_function then
  raise exception 'Função da lista não existe — confira a assinatura: %', f;
end $$;

-- Assinaturas variáveis (surgeon_create_team, admin_*): revoga pelo catálogo,
-- para não depender de acertar cada lista de argumentos.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'admin\_%'
           or p.proname in ('surgeon_create_team','create_professional_invite','alert_update_observation'))
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.assinatura);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- (c) submit_vital_record 21-args: repõe a 0022 na assinatura VIVA.
--     anon fora; authenticated preservado (paridade com a 0022: nenhuma tela
--     autenticada a chama por token); service_role é o caminho da Edge Function.
-- ----------------------------------------------------------------------------
revoke execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean, boolean, int, boolean
) from public, anon;
grant execute on function public.submit_vital_record(
  text, text, numeric, int, int, int, int, int, int, int, int, boolean, int, text, boolean, text, boolean, boolean, boolean, int, boolean
) to service_role;

-- ----------------------------------------------------------------------------
-- VERIFICAÇÃO: rode supabase/_scripts/testes/02_matriz_escrita_guardas.sql —
-- G08 deve listar zero funções executáveis por anon; e o preflight/G09 não
-- pode mais conseguir executar as funções de manutenção como anon.
-- ----------------------------------------------------------------------------
