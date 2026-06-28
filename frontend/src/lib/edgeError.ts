/**
 * Extrai a mensagem amigável (PT-BR) retornada por uma Edge Function.
 *
 * O supabase-js embrulha respostas de erro num FunctionsHttpError cujo corpo
 * (JSON `{ error }`) fica em `error.context` (um Response). Caímos para a
 * mensagem do próprio erro ou um fallback quando o corpo não é JSON.
 */
export async function extractEdgeError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      // corpo não-JSON
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
