/**
 * Contato de suporte técnico exibido nas telas públicas do paciente (link do
 * WhatsApp), para o caso de problema técnico ao registrar a medição — não é
 * canal clínico.
 *
 * TODO: o e-mail/telefone reais ainda não foram informados pelo dono do
 * produto. Os valores abaixo são placeholders (só aparecem se as env vars
 * não forem definidas) — substitua via VITE_SUPPORT_CONTACT_EMAIL /
 * VITE_SUPPORT_CONTACT_PHONE antes de liberar para pacientes reais.
 */
const email = String(import.meta.env.VITE_SUPPORT_CONTACT_EMAIL ?? '').trim();
const phone = String(import.meta.env.VITE_SUPPORT_CONTACT_PHONE ?? '').trim();

export const supportContact = {
  email: email || 'suporte@vitalsync.example.com',
  phone: phone || '(41) 00000-0000',
  /** true quando os valores acima ainda são o placeholder (não configurados). */
  isPlaceholder: !email && !phone,
} as const;

/**
 * Número OFICIAL do WhatsApp usado pela equipe para contato ativo com o
 * paciente. Precisa ser mostrado a ele ANTES de qualquer ligação: no Brasil,
 * mensagem de número desconhecido que já sabe a pressão do paciente é
 * indistinguível de golpe.
 *
 * Sem `VITE_WHATSAPP_OFICIAL` configurado, o aviso é exibido SEM o número
 * (texto genérico) — inventar um número seria pior do que omitir.
 */
const whatsappOficial = String(import.meta.env.VITE_WHATSAPP_OFICIAL ?? '').trim();

export const contatoOficial = {
  whatsapp: whatsappOficial,
  configurado: whatsappOficial.length > 0,
} as const;
