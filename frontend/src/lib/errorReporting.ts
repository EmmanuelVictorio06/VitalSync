/**
 * Relato de erros de JavaScript para `client_error_logs` (migration 0070).
 *
 * ⚠️ REGRA CENTRAL: a URL do paciente contém o `secure_token` — credencial de
 * acesso a dado de saúde. Nada que possa conter token, CPF, e-mail ou telefone
 * pode ser gravado cru. Tudo passa por `redigir()` antes de sair daqui, e a
 * rota é registrada como PADRÃO ('/registro-sinais/:token'), nunca como URL
 * real. Se você adicionar um campo novo, ele também precisa passar por
 * `redigir()`.
 *
 * Nunca inclua em `extra` valores de sinais vitais, nome, CPF ou telefone.
 */
import { supabase } from './supabase';

/** Padrões de rota conhecidos — o que é gravado no lugar da URL real. */
const ROTAS_PUBLICAS: Array<{ regex: RegExp; pattern: string }> = [
  { regex: /^\/registro-sinais\/[^/]+/, pattern: '/registro-sinais/:token' },
  { regex: /^\/r\/[^/]+/, pattern: '/r/:token' },
  { regex: /^\/convite\/[^/]+/, pattern: '/convite/:token' },
  { regex: /^\/patients\/[^/]+\/registrar-medicao/, pattern: '/patients/:id/registrar-medicao' },
  { regex: /^\/patients\/[^/]+/, pattern: '/patients/:id' },
  { regex: /^\/admin\/teams\/[^/]+/, pattern: '/admin/teams/:teamId' },
];

const REDIGIDO = '[REDIGIDO]';

/**
 * Remove do texto tudo que possa identificar alguém ou dar acesso ao sistema.
 *
 * A ordem importa: e-mail e CPF antes da regra genérica de token, senão a
 * regra de 20+ alfanuméricos come pedaços do e-mail e o resultado fica
 * ilegível para diagnóstico.
 */
export function redigir(texto: string | null | undefined): string | null {
  if (!texto) return null;
  return texto
    // e-mails
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, REDIGIDO)
    // CPF com ou sem máscara
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, REDIGIDO)
    // telefone BR com ou sem DDI/DDD/máscara (10–13 dígitos)
    .replace(/(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g, REDIGIDO)
    // tokens: sequências longas de alfanuméricos (o secure_token tem 48 chars)
    .replace(/[A-Za-z0-9_-]{20,}/g, REDIGIDO);
}

/**
 * Converte um caminho real em padrão de rota. Nunca devolve o caminho cru
 * quando ele casa com uma rota que tem parâmetro sensível.
 */
export function padraoDaRota(pathname: string): string {
  for (const { regex, pattern } of ROTAS_PUBLICAS) {
    if (regex.test(pathname)) return pattern;
  }
  // Rota sem parâmetro: o próprio caminho já é o padrão — ainda assim redigido
  // por segurança, caso apareça uma rota nova com id no meio.
  return redigir(pathname) ?? '/';
}

/** Janela de deduplicação: o mesmo erro não é enviado de novo dentro dela. */
const JANELA_DEDUP_MS = 60_000;
const enviadosRecentemente = new Map<string, number>();

/** Exposto para os testes conseguirem isolar cada caso. */
export function _limparDedup(): void {
  enviadosRecentemente.clear();
}

/** true se este erro já foi relatado há menos de 60s (e deve ser ignorado). */
function ehDuplicado(chave: string, agora: number): boolean {
  const anterior = enviadosRecentemente.get(chave);
  if (anterior !== undefined && agora - anterior < JANELA_DEDUP_MS) return true;
  enviadosRecentemente.set(chave, agora);
  // Limpeza preguiçosa para o Map não crescer sem limite numa sessão longa.
  if (enviadosRecentemente.size > 50) {
    for (const [k, t] of enviadosRecentemente) {
      if (agora - t >= JANELA_DEDUP_MS) enviadosRecentemente.delete(k);
    }
  }
  return false;
}

export interface ContextoErro {
  /** 'app' | 'registro-paciente' | ... — de onde veio. */
  contexto: string;
  /** Informação NÃO sensível para diagnóstico (nunca dado clínico/pessoal). */
  extra?: Record<string, string | number | boolean | null>;
}

/**
 * Grava o erro em `client_error_logs`. Nunca lança: um reporter que estoura
 * dentro de um ErrorBoundary cria loop infinito.
 *
 * Ponto de extensão do Sentry: se `VITE_SENTRY_DSN` estiver definido, é aqui
 * que o encaminhamento entraria. A dependência NÃO foi adicionada — incluir
 * SDK de terceiro que recebe stack de uma aplicação de saúde é decisão do dono
 * do produto (ver docs/RUNBOOK_PILOTO.md).
 */
export async function reportError(error: unknown, ctx: ContextoErro): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const messageBase = redigir(err.message);

    if (ehDuplicado(`${ctx.contexto}::${messageBase ?? ''}`, Date.now())) return;

    // `extra` entra junto da mensagem para não exigir coluna nova — e passa
    // pela MESMA redação, porque é o campo mais fácil de alguém encher de dado
    // do paciente sem perceber.
    const extraRedigido = ctx.extra ? redigir(JSON.stringify(ctx.extra)) : null;
    const message = extraRedigido ? `${messageBase ?? ''} · ${extraRedigido}` : messageBase;

    const stack = redigir(err.stack)?.slice(0, 4000) ?? null;
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

    let profileId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      profileId = data.user?.id ?? null;
    } catch {
      // Sessão indisponível (tela pública do paciente) — segue anônimo.
    }

    await supabase.from('client_error_logs').insert({
      contexto: ctx.contexto,
      message,
      stack,
      route_pattern: padraoDaRota(pathname),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
      profile_id: profileId,
      app_version: import.meta.env.VITE_APP_VERSION ?? null,
    });
  } catch {
    // Silêncio proposital: relatar falha de relato causaria recursão.
  }
}

/**
 * Liga os handlers globais. `ErrorBoundary` só pega erro de RENDER — erro
 * assíncrono (promise rejeitada, callback) passa direto por ele e cairia no
 * console sem ninguém ver.
 */
export function instalarCapturaGlobalDeErros(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    void reportError(e.error ?? e.message, { contexto: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', (e) => {
    void reportError(e.reason, { contexto: 'promise-nao-tratada' });
  });
}
