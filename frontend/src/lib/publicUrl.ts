/**
 * Base pública para os links enviados ao PACIENTE (WhatsApp).
 *
 * Por que isto existe: usar `window.location.origin` gera o link a partir do
 * domínio que o ADMIN está navegando. Se o admin abrir o app por uma URL de
 * *preview* da Vercel (ex.: `*-git-branch-usuario.vercel.app`), esse domínio
 * costuma ter **Deployment Protection** ligada — e o paciente cai numa tela de
 * acesso/login da Vercel ao abrir o link.
 *
 * Solução: fixar o domínio de PRODUÇÃO em `VITE_PUBLIC_APP_URL` (Vercel →
 * Project → Settings → Environment Variables, escopo Production). O link do
 * paciente sempre aponta para o domínio público de produção.
 *
 * Fallback: se a variável não estiver definida (ex.: `localhost` em dev),
 * usa `window.location.origin` — o que é correto para desenvolvimento local.
 */
export function publicAppBaseUrl(): string {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  const base = configured || window.location.origin;
  return base.replace(/\/+$/, ''); // remove barra(s) final(is)
}

/** Link público (sem login) do formulário de sinais vitais do paciente. */
export function patientVitalsLink(secureToken: string): string {
  return `${publicAppBaseUrl()}/registro-sinais/${secureToken}`;
}
