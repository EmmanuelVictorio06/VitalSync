/**
 * Geração de CSV compatível com Excel/Google Sheets em pt-BR.
 *
 * Decisões de formato (evitam os problemas clássicos de acento e separador):
 *   • UTF-8 com BOM  → o Excel reconhece os acentos.
 *   • Separador ';'  → o Excel pt-BR usa ';' como separador de lista.
 *   • Datas pt-BR    → dd/mm/aaaa (helpers abaixo).
 */

export type CsvCell = string | number | null | undefined;

/** Escapa uma célula: aspas duplicadas e sempre entre aspas (seguro p/ ';'). */
function escapeCell(c: CsvCell): string {
  return `"${String(c ?? '').replace(/"/g, '""')}"`;
}

/** Monta o texto CSV (separador ';', quebras CRLF) com BOM no início. */
export function buildCsv(rows: CsvCell[][]): string {
  const body = rows.map((r) => r.map(escapeCell).join(';')).join('\r\n');
  return '﻿' + body; // BOM
}

/** Dispara o download do CSV no navegador. */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Data em pt-BR (dd/mm/aaaa); vazio se nula/ inválida. */
export function csvDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

/** Data e hora em pt-BR (dd/mm/aaaa hh:mm); vazio se nula/ inválida. */
export function csvDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR');
}
