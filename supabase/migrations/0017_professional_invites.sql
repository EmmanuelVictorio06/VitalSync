-- ============================================================================
-- VitalSync — Convite de profissionais (médico/cirurgião) por link
--
-- Admin ou Suporte gera um convite com token único; o link é enviado por
-- WhatsApp. O profissional acessa, preenche o cadastro e DEFINE A PRÓPRIA SENHA.
-- A criação da conta no Auth acontece na Edge Function `accept-invite`
-- (service_role) — nunca no frontend.
--
-- Rode no SQL Editor do Supabase após o 0016.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CPF único também para profissionais (mesmo padrão dos pacientes): só o hash.
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists cpf_hash text;
create unique index if not exists uq_profiles_cpf_hash
  on public.profiles(cpf_hash) where cpf_hash is not null;

-- ----------------------------------------------------------------------------
-- Tabela de convites.
-- ----------------------------------------------------------------------------
create table if not exists public.professional_invites (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  role          text not null check (role in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR')),
  team_id       uuid references public.medical_teams(id) on delete set null,
  invited_phone text,
  invited_email text,
  expires_at    timestamptz not null default (now() + interval '7 days'),
  used_at       timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_prof_invites_team on public.professional_invites(team_id);

-- ----------------------------------------------------------------------------
-- RLS: só ADMIN e SUPORTE geram/leem convites. O consumo do convite (pelo
-- profissional anônimo) é feito pela Edge Function via service_role.
-- ----------------------------------------------------------------------------
alter table public.professional_invites enable row level security;
drop policy if exists prof_invites_admin_support on public.professional_invites;
create policy prof_invites_admin_support on public.professional_invites for all to authenticated
  using (public.is_admin() or public.is_support())
  with check (public.is_admin() or public.is_support());

-- ----------------------------------------------------------------------------
-- RPC: gera o convite (ADMIN ou SUPORTE) e devolve o token.
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
begin
  if not (public.is_admin() or public.is_support()) then
    raise exception 'Sem permissão para gerar convites.';
  end if;
  if p_role not in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
    raise exception 'Papel inválido para convite.';
  end if;

  insert into public.professional_invites (role, team_id, invited_phone, invited_email, created_by)
  values (
    p_role, p_team_id,
    nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    auth.uid()
  )
  returning token into v_token;

  return v_token;
end;
$$;

grant execute on function public.create_professional_invite(text, uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- RPC pública: dados mínimos do convite a partir do token (para a tela de
-- cadastro saber o papel/equipe). NÃO expõe dados sensíveis. Só convite válido.
-- ----------------------------------------------------------------------------
create or replace function public.get_invite_by_token(p_token text)
returns table (role text, team_number int, invited_email text, invited_phone text)
language sql stable security definer set search_path = public as $$
  select i.role, t.team_number, i.invited_email, i.invited_phone
  from public.professional_invites i
  left join public.medical_teams t on t.id = i.team_id
  where i.token = p_token and i.used_at is null and i.expires_at > now();
$$;

grant execute on function public.get_invite_by_token(text) to anon, authenticated;
