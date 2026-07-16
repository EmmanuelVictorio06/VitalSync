-- 0043_professional_tag_auto_update.sql
--
-- Atualiza automaticamente a tag visual quando o nome do usuario muda.
-- A tag continua sendo apenas identificador visual/busca; relacoes usam profiles.id.
--
-- Reaproveita as funcoes existentes public.generate_professional_tag(text) e
-- public.normalize_first_name(text) (0019) e o trigger trg_set_professional_tag
-- (0019, BEFORE INSERT OR UPDATE ON public.profiles). Aqui apenas substituimos o
-- corpo de set_professional_tag(), atualizamos o comment da coluna e refazemos o
-- backfill.

create or replace function public.set_professional_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.professional_tag is null then
      NEW.professional_tag := public.generate_professional_tag(NEW.name);
    end if;
    return NEW;
  end if;
  if NEW.name is distinct from OLD.name then
    NEW.professional_tag := public.generate_professional_tag(NEW.name);
  elsif NEW.professional_tag is null then
    NEW.professional_tag := public.generate_professional_tag(NEW.name);
  end if;
  return NEW;
end;
$$;

comment on column public.profiles.professional_tag is
  'Tag unica do usuario (PrimeiroNomeReal#0000). Identificador visual/busca; atualizada automaticamente quando o nome muda; relacoes usam profiles.id.';

do $$
declare
  r record;
begin
  for r in
    select id, name
      from public.profiles
     where professional_tag is null
        or split_part(professional_tag, '#', 1) is distinct from public.normalize_first_name(name)
  loop
    update public.profiles
       set professional_tag = public.generate_professional_tag(name)
     where id = r.id;
  end loop;
end $$;
