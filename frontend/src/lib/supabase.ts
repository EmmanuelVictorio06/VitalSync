/**
 * Cliente Supabase (Auth + Database + Storage) para a arquitetura
 * Vercel + Supabase (sem backend separado).
 *
 * As chaves vêm de variáveis de ambiente do Vite. Nunca colocar a
 * `service_role` aqui — somente a `anon` (pública). Operações sensíveis
 * (WhatsApp, validação de token do paciente) vão para Edge Functions.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** URL de fallback usada só para o cliente não quebrar no import (nunca é chamada). */
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';

/**
 * Aceita apenas uma URL https real — descarta vazio, o placeholder e textos de
 * exemplo (ex.: "COLE_AQUI...", "https://SEU-PROJETO.supabase.co"). Assim, um
 * `.env.local` ainda não preenchido cai em "não configurado" (mensagem clara)
 * em vez de disparar requisições para um host que não resolve.
 */
function isRealSupabaseUrl(url: string | undefined): url is string {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'placeholder.supabase.co') return false;
  // Hosts de exemplo não preenchidos (mantém placeholders óbvios fora do ar).
  if (host.includes('seu-projeto') || host.includes('cole_aqui') || host.includes('xxxx')) return false;
  return true;
}

function isRealAnonKey(key: string | undefined): key is string {
  if (!key) return false;
  if (key === 'public-anon-key-missing') return false;
  if (/^cole_aqui/i.test(key) || /sua-chave|sua-anon|placeholder/i.test(key)) return false;
  return true;
}

/** Permite à UI mostrar um erro claro em vez de quebrar com tela branca. */
export const isSupabaseConfigured = isRealSupabaseUrl(supabaseUrl) && isRealAnonKey(supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Não lança no import (evita tela branca); apenas registra o problema.
  console.error(
    'Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (.env.local / Vercel).',
  );
}

// Quando não configurado, usa o fallback (URL válida, mas nunca chamada porque
// os serviços checam `isSupabaseConfigured` antes de fazer requisições).
export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl! : PLACEHOLDER_URL,
  isSupabaseConfigured ? supabaseAnonKey! : 'public-anon-key-missing',
);
