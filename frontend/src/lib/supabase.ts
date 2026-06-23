/**
 * Cliente Supabase (Auth + Database + Storage) para a arquitetura
 * Vercel + Supabase (sem backend separado).
 *
 * As chaves vêm de variáveis de ambiente do Vite. Nunca colocar a
 * `service_role` aqui — somente a `anon` (pública). Operações sensíveis
 * (WhatsApp, validação de token do paciente) vão para Edge Functions.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Permite à UI mostrar um erro claro em vez de quebrar com tela branca. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Não lança no import (evita tela branca); apenas registra o problema.
  console.error(
    'Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (.env.local / Vercel).',
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'public-anon-key-missing',
);
