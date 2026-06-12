import ExcelJS from 'exceljs';
import { Period } from '@vitalsync/shared';
import type { ExportFile, ExportFormat, ExportService } from '../../application/ports.js';
import type { ExportRow } from '../../domain/repositories.js';

/** Colunas da exportação (dados cadastrais + medição). */
const COLUMNS: Array<{ header: string; get: (r: ExportRow) => string | number }> = [
  { header: 'Paciente', get: (r) => r.patientName },
  { header: 'Data de nascimento', get: (r) => fmtDate(r.birthDate) },
  { header: 'Telefone', get: (r) => r.phone },
  { header: 'Equipe', get: (r) => r.teamNumber },
  { header: 'Cirurgião', get: (r) => r.surgeonName ?? '' },
  { header: 'Cirurgia', get: (r) => r.surgeryType },
  { header: 'Hospital', get: (r) => r.hospital },
  { header: 'Data da cirurgia', get: (r) => fmtDate(r.surgeryDate) },
  { header: 'Data da alta', get: (r) => fmtDate(r.dischargeDate) },
  { header: 'Dia monitoramento', get: (r) => r.record?.monitoringDay ?? '' },
  { header: 'Período', get: (r) => (r.record ? periodLabel(r.record.period) : '') },
  { header: 'Data medição', get: (r) => (r.record ? fmtDate(r.record.recordDate) : '') },
  { header: 'Temperatura (°C)', get: (r) => r.record?.temperature ?? '' },
  { header: 'Saturação (%)', get: (r) => r.record?.spo2 ?? '' },
  { header: 'Sistólica (mmHg)', get: (r) => r.record?.systolic ?? '' },
  { header: 'Diastólica (mmHg)', get: (r) => r.record?.diastolic ?? '' },
  { header: 'FC (bpm)', get: (r) => r.record?.heartRate ?? '' },
  { header: 'Dor (0-10)', get: (r) => r.record?.pain ?? '' },
  { header: 'Dispneia (0-10)', get: (r) => r.record?.dyspnea ?? '' },
  { header: 'Urinou normalmente', get: (r) => boolLabel(r.record?.urinatedNormally) },
  { header: 'Micções', get: (r) => r.record?.urinationCount ?? '' },
  { header: 'Vômito', get: (r) => boolLabel(r.record?.hadVomit) },
  { header: 'Qtd vômitos', get: (r) => r.record?.vomitCount ?? '' },
  { header: 'Sangramento', get: (r) => boolLabel(r.record?.hadBleeding) },
  { header: 'Passos', get: (r) => r.record?.stepsCount ?? '' },
  { header: 'Status', get: (r) => r.record?.overallStatus ?? '' },
  { header: 'Enviado em', get: (r) => (r.record ? fmtDateTime(r.record.submittedAt) : '') },
];

/**
 * Serviço de exportação isolado. Gera XLSX ou CSV a partir das mesmas linhas —
 * trocar/estender o formato não afeta as use cases.
 */
export class ExcelExportService implements ExportService {
  async build(rows: ExportRow[], format: ExportFormat): Promise<ExportFile> {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      return { filename: `vitalsync_export_${stamp}.csv`, contentType: 'text/csv; charset=utf-8', buffer: this.toCsv(rows) };
    }
    return {
      filename: `vitalsync_export_${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await this.toXlsx(rows),
    };
  }

  private toCsv(rows: ExportRow[]): Buffer {
    const escape = (v: string | number): string => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [COLUMNS.map((c) => escape(c.header)).join(';')];
    for (const r of rows) lines.push(COLUMNS.map((c) => escape(c.get(r))).join(';'));
    // BOM para acentuação correta no Excel.
    return Buffer.from('﻿' + lines.join('\r\n'), 'utf-8');
  }

  private async toXlsx(rows: ExportRow[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'VitalSync';
    const ws = wb.addWorksheet('Pacientes e Medições');
    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 18 }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(COLUMNS.map((c) => c.get(r)));
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }
}

function fmtDate(d: Date): string {
  return d ? new Date(d).toLocaleDateString('pt-BR') : '';
}
function fmtDateTime(d: Date): string {
  return d ? new Date(d).toLocaleString('pt-BR') : '';
}
function periodLabel(p: Period): string {
  return p === Period.MORNING ? 'Manhã' : 'Noite';
}
function boolLabel(v: boolean | undefined): string {
  if (v === undefined) return '';
  return v ? 'Sim' : 'Não';
}
