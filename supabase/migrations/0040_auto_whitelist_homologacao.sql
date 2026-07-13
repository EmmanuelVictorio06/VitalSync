-- ============================================================================
-- Migration: 0040_auto_whitelist_homologacao
--
-- Durante a semana de teste (homologation_mode = true), todo profissional
-- cadastrado no sistema passa a receber os alertas de WhatsApp automaticamente
-- — sem precisar editar `homologation_settings.test_recipients` na mão.
--
-- Abordagem: trigger em public.profiles (ponto único de gravação do
-- WhatsApp, tanto para admin-create-user quanto para accept-invite — nenhuma
-- Edge Function precisa mudar).
--
-- Papéis incluídos — decidido lendo notify_team_of_alert (0018), não
-- supondo: os destinatários de um alerta vêm só de
-- medical_teams.main_surgeon_id (sempre MEDICAL_SURGEON pós-0031) e de
-- team_members ativos (sempre ASSOCIATED_DOCTOR — travado pelo CHECK
-- team_members_role_associate_only da 0030). TEAM_MANAGER e ADMIN NUNCA são
-- destinatários de alerta clínico, então não entram na auto-whitelist.
--
-- Formato armazenado: normalize_phone(NEW.whatsapp) (dígitos). O match em
-- notify_team_of_alert normaliza os dois lados
-- (normalize_phone(x) = normalize_phone(r.whatsapp)), então funcionaria cru
-- também — normalizamos na escrita só para manter test_recipients canônico.
--
-- Escopo deliberadamente só ADITIVO: desativar/remover um profissional NÃO
-- tira o número da whitelist (mantém simples — confirmado com o usuário). A
-- whitelist é limpa manualmente ao encerrar a homologação
-- (homologation_set_recipients / update direto).
--
-- ADITIVA e IDEMPOTENTE. Rode no SQL Editor após o 0018.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Trigger function: adiciona o WhatsApp do profissional à whitelist quando
--    a homologação está ligada. Sai cedo em qualquer condição que não se
--    aplique — nunca bloqueia o INSERT/UPDATE de profiles.
-- ----------------------------------------------------------------------------
create or replace function public.sync_homologation_whitelist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mode  boolean;
  v_phone text;
begin
  if coalesce(trim(NEW.whatsapp), '') = '' then
    return NEW;
  end if;

  if NEW.role::text not in ('MEDICAL_SURGEON', 'ASSOCIATED_DOCTOR') then
    return NEW;
  end if;

  if NEW.status <> 'ACTIVE' then
    return NEW;
  end if;

  select homologation_mode into v_mode from public.homologation_settings where id;
  if not coalesce(v_mode, false) then
    return NEW;
  end if;

  v_phone := public.normalize_phone(NEW.whatsapp);
  if v_phone = '' then
    return NEW;
  end if;

  -- O WHERE exclui o caso em que o número já está na lista — evita duplicar
  -- e evita um UPDATE (e o updated_at) sem necessidade real.
  update public.homologation_settings
     set test_recipients = test_recipients || array[v_phone],
         updated_at = now()
   where id
     and not (v_phone = any (test_recipients));

  return NEW;
end;
$$;

drop trigger if exists trg_sync_homologation_whitelist on public.profiles;
create trigger trg_sync_homologation_whitelist
  after insert or update of whatsapp, role, status on public.profiles
  for each row execute function public.sync_homologation_whitelist();

-- ----------------------------------------------------------------------------
-- 2) Backfill único: inclui quem já estava cadastrado (com WhatsApp, papel
--    elegível, ativo) antes deste trigger existir. Idempotente — dedup via
--    array_agg(distinct ...) sobre a união do que já está na lista com o que
--    deveria estar; rodar de novo não duplica nem some com nada.
-- ----------------------------------------------------------------------------
update public.homologation_settings h
   set test_recipients = coalesce((
         select array_agg(distinct t.phone) filter (where t.phone <> '')
         from (
           select unnest(h.test_recipients) as phone
           union
           select public.normalize_phone(p.whatsapp) as phone
           from public.profiles p
           where p.role::text in ('MEDICAL_SURGEON', 'ASSOCIATED_DOCTOR')
             and p.status = 'ACTIVE'
             and coalesce(trim(p.whatsapp), '') <> ''
         ) t
       ), '{}'::text[]),
       updated_at = now()
 where h.id;
