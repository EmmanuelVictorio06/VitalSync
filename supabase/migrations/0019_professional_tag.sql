-- ============================================================================
-- VitalSync — Tag única do profissional (PrimeiroNomeReal#0000)
--
-- Identificador VISUAL e de BUSCA para cirurgiões principais e médicos
-- associados, facilitando distinguir nomes parecidos nas telas de equipe,
-- perfil e seleção. A tag NÃO é chave: as relações continuam usando profiles.id.
--
-- Regras (centralizadas aqui, no banco — fonte da verdade):
--   • Formato: <PrimeiroNomeReal>#<4 dígitos>  (ex.: Joao#4821).
--   • O nome base IGNORA títulos/cargos (Dr., Dra., Médico, Cirurgião,
--     Principal, Associado…), acentos e pontuação — usa o 1º nome real.
--   • Unicidade garantida por índice único (não depende do frontend).
--   • Gerada automaticamente (trigger) para MAIN_SURGEON e ASSOCIATED_DOCTOR
--     em QUALQUER caminho de criação (handle_new_user, admin_create_doctor,
--     admin_create_user, Edge Function accept-invite).
--   • Nunca é sobrescrita depois de definida; nada de nome/role/permissão muda.
--
-- ADITIVO e IDEMPOTENTE. Não apaga dados. Rode no SQL Editor após o 0018.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Coluna + unicidade real no banco.
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists professional_tag text;

create unique index if not exists uq_profiles_professional_tag
  on public.profiles(professional_tag) where professional_tag is not null;

comment on column public.profiles.professional_tag is
  'Tag única do profissional (PrimeiroNomeReal#0000). Identificador visual/busca; nunca é chave — relações usam profiles.id.';

-- ----------------------------------------------------------------------------
-- 2) Normaliza o nome → primeiro NOME REAL, sem títulos/acentos/pontuação.
--    Remove prefixos genéricos repetidos do início (Dr., Médico, Cirurgião,
--    Principal, Associado…). Fallback seguro 'User' se nada sobrar.
-- ----------------------------------------------------------------------------
create or replace function public.normalize_first_name(p_name text)
returns text language plpgsql immutable as $$
declare
  v_name text := coalesce(p_name, '');
  v_word text;
begin
  -- remove acentos (translate manual — não depende da extensão unaccent)
  v_name := translate(
    v_name,
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  );
  -- mantém apenas letras e espaços; pontuação/dígitos viram espaço
  v_name := regexp_replace(v_name, '[^A-Za-z ]', ' ', 'g');
  -- colapsa espaços e apara as pontas
  v_name := btrim(regexp_replace(v_name, '\s+', ' ', 'g'));

  -- descarta títulos/cargos do INÍCIO, repetidamente (já sem acento)
  loop
    v_word := split_part(v_name, ' ', 1);
    exit when v_word = '';
    if lower(v_word) in (
      'dr','dra','doutor','doutora','medico','medica',
      'cirurgiao','cirurgia','profissional','principal',
      'associado','associada','sr','sra','prof'
    ) then
      v_name := btrim(substr(v_name, length(v_word) + 1));
    else
      exit;
    end if;
  end loop;

  v_word := split_part(v_name, ' ', 1);
  if v_word = '' then
    return 'User'; -- último caso: nome só tinha títulos/caracteres inválidos
  end if;

  -- capitalização limpa: primeira maiúscula, resto minúsculo
  return upper(left(v_word, 1)) || lower(substr(v_word, 2));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) Gera uma tag ÚNICA "<NomeReal>#0000". Tenta novos dígitos em caso de
--    colisão; satura para 5 dígitos só num cenário extremo (>10k mesmo nome).
-- ----------------------------------------------------------------------------
create or replace function public.generate_professional_tag(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_base text := public.normalize_first_name(p_name);
  v_tag  text;
  v_try  int := 0;
begin
  loop
    v_try := v_try + 1;
    if v_try <= 100 then
      v_tag := v_base || '#' || lpad((floor(random() * 10000))::int::text, 4, '0');
    else
      -- válvula de segurança: amplia o espaço para garantir saída
      v_tag := v_base || '#' || lpad((floor(random() * 100000))::int::text, 5, '0');
    end if;
    exit when not exists (select 1 from public.profiles where professional_tag = v_tag);
  end loop;
  return v_tag;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) Trigger: define a tag automaticamente para os papéis médicos quando ainda
--    não houver uma. Vale para INSERT (todos os fluxos passam por aqui) e para
--    UPDATE (ex.: usuário promovido a cirurgião/associado). NUNCA sobrescreve.
-- ----------------------------------------------------------------------------
create or replace function public.set_professional_tag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.professional_tag is null
     and NEW.role in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR') then
    NEW.professional_tag := public.generate_professional_tag(NEW.name);
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_set_professional_tag on public.profiles;
create trigger trg_set_professional_tag
  before insert or update on public.profiles
  for each row execute function public.set_professional_tag();

-- ----------------------------------------------------------------------------
-- 5) Backfill dos profissionais EXISTENTES sem tag (linha a linha, para que a
--    unicidade enxergue as tags já geradas na mesma transação). Só preenche o
--    que está nulo — não sobrescreve, não apaga, não altera nome/role/status.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select id, name from public.profiles
    where professional_tag is null
      and role in ('MAIN_SURGEON', 'ASSOCIATED_DOCTOR')
  loop
    update public.profiles
       set professional_tag = public.generate_professional_tag(name)
     where id = r.id;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6) Expor a tag na visão de "Gerenciar Usuários" (a RPC lista colunas a uma a
--    uma — incluímos professional_tag preservando todo o resto).
--
--    Mudar o tipo de retorno exige DROP antes: o Postgres não troca o row type
--    (OUT params) de uma função existente via CREATE OR REPLACE.
-- ----------------------------------------------------------------------------
drop function if exists public.admin_get_users_overview();

create or replace function public.admin_get_users_overview()
returns table (
  id            uuid,
  name          text,
  email         text,
  whatsapp      text,
  role          text,
  status        text,
  avatar_url    text,
  specialty     text,
  crm           text,
  notes         text,
  professional_tag text,
  created_at    timestamptz,
  updated_at    timestamptz,
  last_sign_in_at timestamptz,
  team_count    bigint
)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para acessar esta página.';
  end if;

  return query
  select p.id, p.name, p.email, p.whatsapp, p.role::text, p.status::text,
         p.avatar_url, p.specialty, p.crm, p.notes, p.professional_tag,
         p.created_at, p.updated_at, u.last_sign_in_at,
         (select count(*) from public.team_members tm where tm.doctor_id = p.id and tm.status = 'ACTIVE')
         + (select count(*) from public.medical_teams mt where mt.main_surgeon_id = p.id) as team_count
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by p.name;
end;
$$;

grant execute on function public.admin_get_users_overview() to authenticated;
