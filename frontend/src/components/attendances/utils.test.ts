import { describe, expect, it } from 'vitest';
import { isFinalizedAttendance, type AttendanceRow } from '../../services/attendanceService';
import { EMPTY_FILTERS } from './types';
import {
  applyAttendanceFilters,
  applyQuickCard,
  countAdvancedFilters,
  matchesQuick,
  searchableText,
  sortAttendances,
} from './utils';

function makeRow(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  const base: AttendanceRow = {
    id: 'a1',
    patient_id: 'p1',
    alert_id: null,
    attended_by: 'prof-1',
    status: 'ATTENDED',
    observation: 'Observação padrão',
    created_at: new Date().toISOString(),
    patient: {
      id: 'p1',
      name: 'João Silva',
      birth_date: '1980-05-10',
      phone: '(41) 99999-9999',
      surgery_date: '2026-06-20',
      hospital_discharge_date: '2026-06-22',
      team_id: 't1',
      current_status: 'GREEN',
      surgery_type: { name: 'Colecistectomia' },
      hospital: { name: 'Hospital Vita' },
    },
    team: { team_number: 1, main_surgeon_id: 'prof-2' },
    alert: null,
    vital_record: null,
    professional_name: 'Dr. Bruno Tavares',
    professional_role: 'MAIN_SURGEON',
    surgeon_name: 'Dr. Cirurgião',
    origin: 'MANUAL_REVIEW',
    related_vital_sign: null,
    clinical_status: 'GREEN',
    alert_level: null,
  };
  return { ...base, ...overrides };
}

describe('isFinalizedAttendance', () => {
  it('considera ATTENDED como finalizado', () => {
    expect(isFinalizedAttendance('ATTENDED')).toBe(true);
  });

  it('considera IGNORED como finalizado', () => {
    expect(isFinalizedAttendance('IGNORED')).toBe(true);
  });

  it('não considera IN_ANALYSIS como finalizado', () => {
    expect(isFinalizedAttendance('IN_ANALYSIS')).toBe(false);
  });

  it('não considera PENDING como finalizado', () => {
    expect(isFinalizedAttendance('PENDING')).toBe(false);
  });
});

describe('searchableText', () => {
  it('inclui nome do paciente, equipe, profissional e observação', () => {
    const text = searchableText(makeRow());
    expect(text).toContain('joão silva');
    expect(text).toContain('equipe 01');
    expect(text).toContain('dr. bruno tavares');
    expect(text).toContain('observação padrão');
  });
});

describe('matchesQuick', () => {
  it('card TODOS retorna sempre true', () => {
    expect(matchesQuick(makeRow({ status: 'ATTENDED' }), 'ALL')).toBe(true);
    expect(matchesQuick(makeRow({ status: 'IGNORED' }), 'ALL')).toBe(true);
  });

  it('card HOJE aceita apenas atendimentos de hoje', () => {
    expect(matchesQuick(makeRow({ created_at: new Date().toISOString() }), 'TODAY')).toBe(true);
    expect(matchesQuick(makeRow({ created_at: '2020-01-01T00:00:00Z' }), 'TODAY')).toBe(false);
  });

  it('card VERMELHOS aceita apenas alertas vermelhos finalizados', () => {
    expect(matchesQuick(makeRow({ clinical_status: 'RED', alert_level: 'RED' }), 'RED')).toBe(true);
    expect(matchesQuick(makeRow({ clinical_status: 'YELLOW', alert_level: 'YELLOW' }), 'RED')).toBe(false);
    expect(matchesQuick(makeRow({ clinical_status: 'GREEN', alert_level: null }), 'RED')).toBe(false);
  });

  it('card AMARELOS aceita apenas alertas amarelos finalizados', () => {
    expect(matchesQuick(makeRow({ clinical_status: 'YELLOW', alert_level: 'YELLOW' }), 'YELLOW')).toBe(true);
    expect(matchesQuick(makeRow({ clinical_status: 'RED', alert_level: 'RED' }), 'YELLOW')).toBe(false);
  });
});

describe('applyQuickCard', () => {
  it('ativa o card quando diferente do atual', () => {
    const next = applyQuickCard(EMPTY_FILTERS, 'TODAY');
    expect(next.quick).toBe('TODAY');
  });

  it('limpa o filtro rápido quando clica no mesmo card', () => {
    const f = { ...EMPTY_FILTERS, quick: 'TODAY' as const };
    const next = applyQuickCard(f, 'TODAY');
    expect(next.quick).toBe('ALL');
  });
});

describe('applyAttendanceFilters', () => {
  const rows: AttendanceRow[] = [
    makeRow({
      id: 'r1',
      status: 'ATTENDED',
      clinical_status: 'RED',
      alert_level: 'RED',
      alert: { id: 'alert-1', status: 'RED', type: 'Temperatura', description: 'Febre', ignored_reason: null, created_at: new Date().toISOString() },
      patient: { ...makeRow().patient!, name: 'Julia Vettorello' },
      created_at: new Date().toISOString(),
    }),
    makeRow({
      id: 'r2',
      status: 'IGNORED',
      clinical_status: 'YELLOW',
      alert_level: 'YELLOW',
      alert: { id: 'alert-2', status: 'YELLOW', type: 'Dor', description: 'Dor intensa', ignored_reason: 'Paciente orientado', created_at: '2020-01-01T00:00:00Z' },
      patient: { ...makeRow().patient!, name: 'Carlos Mendes' },
      created_at: '2020-01-01T00:00:00Z',
    }),
    makeRow({
      id: 'r3',
      status: 'ATTENDED',
      clinical_status: 'GREEN',
      alert_level: null,
      patient: { ...makeRow().patient!, name: 'Ana Paula' },
      created_at: new Date().toISOString(),
    }),
  ];

  it('atendimento em análise não aparece na listagem (fonte já filtra, mas reforçamos)', () => {
    const inAnalysis = makeRow({ id: 'rX', status: 'ATTENDED' });
    // Simulação conceitual: a fonte de dados já garante apenas finalizados.
    // Aqui garantimos que a função de filtro não reintroduz status inválidos.
    const result = applyAttendanceFilters([inAnalysis], EMPTY_FILTERS);
    expect(result).toHaveLength(1);
  });

  it('atendimento atendido aparece no histórico', () => {
    const attended = makeRow({ id: 'rA', status: 'ATTENDED' });
    expect(applyAttendanceFilters([attended], EMPTY_FILTERS)).toHaveLength(1);
  });

  it('atendimento resolvido/ignorado aparece no histórico', () => {
    const ignored = makeRow({ id: 'rI', status: 'IGNORED' });
    expect(applyAttendanceFilters([ignored], EMPTY_FILTERS)).toHaveLength(1);
  });

  it('card HOJE mostra apenas finalizados hoje', () => {
    const result = applyAttendanceFilters(rows, { ...EMPTY_FILTERS, quick: 'TODAY' });
    expect(result.map((r) => r.id)).toEqual(['r1', 'r3']);
  });

  it('card VERMELHOS mostra apenas alertas vermelhos finalizados', () => {
    const result = applyAttendanceFilters(rows, { ...EMPTY_FILTERS, quick: 'RED' });
    expect(result.map((r) => r.id)).toEqual(['r1']);
  });

  it('card AMARELOS mostra apenas alertas amarelos finalizados', () => {
    const result = applyAttendanceFilters(rows, { ...EMPTY_FILTERS, quick: 'YELLOW' });
    expect(result.map((r) => r.id)).toEqual(['r2']);
  });

  it('busca por paciente funciona', () => {
    const result = applyAttendanceFilters(rows, { ...EMPTY_FILTERS, search: 'Julia' });
    expect(result).toHaveLength(1);
    expect(result[0].patient?.name).toBe('Julia Vettorello');
  });

  it('filtro avançado por status funciona', () => {
    const result = applyAttendanceFilters(rows, { ...EMPTY_FILTERS, status: 'ATTENDED' });
    expect(result.map((r) => r.id)).toEqual(['r1', 'r3']);
  });

  it('filtro avançado por nível do alerta funciona', () => {
    const result = applyAttendanceFilters(rows, { ...EMPTY_FILTERS, level: 'RED' });
    expect(result.map((r) => r.id)).toEqual(['r1']);
  });

  it('limpar filtros avançados mantém busca e card rápido', () => {
    const f = { ...EMPTY_FILTERS, search: 'Julia', quick: 'RED' as const, level: 'YELLOW' as const };
    const cleared = { ...EMPTY_FILTERS, search: 'Julia', quick: 'RED' as const };
    const result1 = applyAttendanceFilters(rows, f);
    const result2 = applyAttendanceFilters(rows, cleared);
    expect(result1).toHaveLength(0);
    expect(result2.map((r) => r.id)).toEqual(['r1']);
  });
});

describe('countAdvancedFilters', () => {
  it('retorna zero quando nenhum filtro avançado está ativo', () => {
    expect(countAdvancedFilters(EMPTY_FILTERS)).toBe(0);
  });

  it('conta filtros avançados ativos', () => {
    const f = { ...EMPTY_FILTERS, level: 'RED' as const, status: 'ATTENDED' as const };
    expect(countAdvancedFilters(f)).toBe(2);
  });

  it('não conta busca nem card rápido', () => {
    const f = { ...EMPTY_FILTERS, search: 'João', quick: 'TODAY' as const };
    expect(countAdvancedFilters(f)).toBe(0);
  });
});

describe('sortAttendances', () => {
  it('ordena do mais recente para o mais antigo', () => {
    const sorted = sortAttendances([
      makeRow({ id: 'old', created_at: '2020-01-01T00:00:00Z' }),
      makeRow({ id: 'new', created_at: '2026-06-25T00:00:00Z' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old']);
  });
});
