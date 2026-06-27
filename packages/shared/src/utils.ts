/** Utilitários puros compartilhados entre backend e frontend. */

import { MONITORING_DAYS } from './types.js';

/** Calcula idade em anos completos a partir da data de nascimento. */
export function calculateAge(birthDate: Date, reference: Date = new Date()): number {
  let age = reference.getFullYear() - birthDate.getFullYear();
  const m = reference.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && reference.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Datas "civis" (sem hora) são representadas de forma canônica como um Date à
 * MEIA-NOITE UTC. Bancos com coluna DATE retornam exatamente nesse formato, o
 * que evita o erro de off-by-one ao misturar fuso local com UTC.
 */

/** Meia-noite UTC do dia de calendário LOCAL atual (o "hoje" do paciente). */
export function startOfToday(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Timestamp (ms) da data civil, lendo sempre os componentes UTC. */
function civilMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Dia de monitoramento (1..10) com base na data da alta hospitalar.
 * Dia da alta = dia 1. Retorna null se fora da janela de monitoramento.
 */
export function monitoringDay(dischargeDate: Date, reference: Date = startOfToday()): number | null {
  const diffDays = Math.round((civilMs(reference) - civilMs(dischargeDate)) / 86_400_000) + 1;
  if (diffDays < 1 || diffDays > MONITORING_DAYS) return null;
  return diffDays;
}

/** Nº de dias decorridos desde a alta (pode passar de 10, p/ exibição "Nº de dias pós-alta"). */
export function daysSinceDischarge(dischargeDate: Date, reference: Date = startOfToday()): number {
  return Math.max(0, Math.round((civilMs(reference) - civilMs(dischargeDate)) / 86_400_000));
}

/** true se a data de referência está dentro da janela de monitoramento (1..10). */
export function isWithinMonitoringWindow(dischargeDate: Date, reference: Date = startOfToday()): boolean {
  return monitoringDay(dischargeDate, reference) !== null;
}

/** Formata uma data civil (meia-noite UTC) como dd/mm/aaaa, sem deslocar o fuso. */
export function formatCivilDate(value: Date | string, locale = 'pt-BR'): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { timeZone: 'UTC' });
}

/** Remove tudo que não for dígito (para WhatsApp/telefone). */
export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

/** Aplica a máscara (xx) xxxxx-xxxx ou (xx) xxxx-xxxx conforme o tamanho. */
export function formatPhoneBR(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return d.replace(/(\d{0,2})/, '($1');
  if (d.length <= 6) return d.replace(/(\d{2})(\d{0,4})/, '($1) $2');
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

/** Monta o número internacional (Brasil = 55) para o link wa.me. */
export function toWhatsappNumber(phone: string, countryCode = '55'): string {
  const d = onlyDigits(phone);
  return d.startsWith(countryCode) ? d : `${countryCode}${d}`;
}

/** Monta o link wa.me com mensagem opcional. */
export function whatsappLink(phone: string, message?: string): string {
  const base = `https://wa.me/${toWhatsappNumber(phone)}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
