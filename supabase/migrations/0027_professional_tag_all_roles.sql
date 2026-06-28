-- ============================================================================
-- VitalSync — Tag única para TODOS os profiles (estende a 0019)
--
-- A 0019 gerava professional_tag apenas para MAIN_SURGEON e ASSOCIATED_DOCTOR.
-- Por decisão do dono, agora TODO profile (incluindo ADMIN e SUPPORT) recebe
-- tag: é barato, garante unicidade global e evita profiles sem tag.
--
-- Reaproveita a função public.generate_professional_tag(text) e o unique index
-- uq_profiles_professional_tag, ambos criados na 0019. NÃO edita a 0019 (já
-- aplicada) — apenas substitui o corpo do trigger e completa o backfill.
--
-- ADITIVA e IDEMPOTENTE. Não apaga dados, não sobrescreve tag existente, não
-- toca em name/email/role/status. Rode no SQL Editor após a 0019.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Trigger: gera a tag para QUALQUER profile sem tag (remove a condição de
--    role). O trigger trg_set_professional_tag (0019, BEFORE INSERT OR UPDATE)
--    já aponta para esta função — basta substituir o corpo.
-- ----------------------------------------------------------------------------
create or replace function public.set_professional_tag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.professional_tag is null then
    NEW.professional_tag := public.generate_professional_tag(NEW.name);
  end if;
  return NEW;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) Backfill dos profiles restantes (ADMIN/SUPPORT e quaisquer outros) que
--    ainda não têm tag. Linha a linha, para que a unicidade enxergue as tags já
--    geradas na mesma transação. Não sobrescreve quem já tem tag.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id, name from public.profiles where professional_tag is null loop
    update public.profiles
       set professional_tag = public.generate_professional_tag(name)
     where id = r.id;
  end loop;
end $$;
