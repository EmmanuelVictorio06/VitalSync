-- ============================================================================
-- VitalSync — Novo perfil: SUPPORT (Suporte)
--
-- Apenas adiciona o valor ao enum user_role. As permissões/políticas que USAM
-- o valor ficam na migration 0016 (boa prática: adicionar valor de enum e usá-lo
-- em migrations separadas evita o erro "unsafe use of new value").
--
-- Rode no SQL Editor do Supabase após o 0014.
-- ============================================================================

alter type public.user_role add value if not exists 'SUPPORT';
