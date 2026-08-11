import { describe, expect, it } from 'vitest';
import {
  isMonitoringEndingSoon,
  needsDay30Assessment,
  needsFollowup48h,
  openForLabel,
  recheckCountdown,
  sortTriageQueue,
} from './nurseDashboard';

/** Data civil canônica (meia-noite UTC), mesma convenção do @vitalsync/shared. */
function civil(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const HOJE = civil('2026-02-10');

describe('needsFollowup48h', () => {
  it('alta há 2 dias e sem followup registrado → precisa', () => {
    expect(
      needsFollowup48h({ dischargeDate: civil('2026-02-08'), hasFollowup: false, reference: HOJE }),
    ).toBe(true);
  });

  it('alta há 1 dia ainda não atingiu as 48h', () => {
    expect(
      needsFollowup48h({ dischargeDate: civil('2026-02-09'), hasFollowup: false, reference: HOJE }),
    ).toBe(false);
  });

  it('followup já registrado nunca aparece na agenda', () => {
    expect(
      needsFollowup48h({ dischargeDate: civil('2026-02-01'), hasFollowup: true, reference: HOJE }),
    ).toBe(false);
  });

  it('sem data de alta não gera pendência', () => {
    expect(needsFollowup48h({ dischargeDate: null, hasFollowup: false, reference: HOJE })).toBe(false);
  });
});

describe('needsDay30Assessment', () => {
  it('exatamente 30 dias de alta e sem avaliação → precisa', () => {
    expect(
      needsDay30Assessment({ dischargeDate: civil('2026-01-11'), hasAssessment: false, reference: HOJE }),
    ).toBe(true);
  });

  it('29 dias ainda não é devido', () => {
    expect(
      needsDay30Assessment({ dischargeDate: civil('2026-01-12'), hasAssessment: false, reference: HOJE }),
    ).toBe(false);
  });

  it('avaliação já registrada sai da agenda', () => {
    expect(
      needsDay30Assessment({ dischargeDate: civil('2025-12-01'), hasAssessment: true, reference: HOJE }),
    ).toBe(false);
  });
});

describe('isMonitoringEndingSoon', () => {
  it('dia 9 de monitoramento entra na lista', () => {
    // Dia da alta = dia 1, então alta em 02/fev → 10/fev é o dia 9.
    expect(isMonitoringEndingSoon({ dischargeDate: civil('2026-02-02'), reference: HOJE })).toBe(true);
  });

  it('dia 10 (último) entra na lista', () => {
    expect(isMonitoringEndingSoon({ dischargeDate: civil('2026-02-01'), reference: HOJE })).toBe(true);
  });

  it('dia 8 ainda não entra', () => {
    expect(isMonitoringEndingSoon({ dischargeDate: civil('2026-02-03'), reference: HOJE })).toBe(false);
  });

  it('fora da janela de 10 dias não entra', () => {
    expect(isMonitoringEndingSoon({ dischargeDate: civil('2026-01-20'), reference: HOJE })).toBe(false);
  });
});

describe('recheckCountdown', () => {
  const agora = new Date('2026-02-10T12:00:00.000Z');

  it('prazo no futuro devolve label "vence em"', () => {
    const r = recheckCountdown('2026-02-10T13:20:00.000Z', agora);
    expect(r.overdue).toBe(false);
    expect(r.minutesRemaining).toBe(80);
    expect(r.label).toBe('vence em 1h20');
  });

  it('menos de uma hora aparece só em minutos', () => {
    expect(recheckCountdown('2026-02-10T12:45:00.000Z', agora).label).toBe('vence em 45min');
  });

  it('prazo passado é marcado como vencido', () => {
    const r = recheckCountdown('2026-02-10T11:25:00.000Z', agora);
    expect(r.overdue).toBe(true);
    expect(r.label).toBe('vencida há 35min');
  });
});

describe('sortTriageQueue', () => {
  const alerts = [
    { id: 'y-novo', status: 'YELLOW', created_at: '2026-02-10T11:00:00.000Z' },
    { id: 'r-novo', status: 'RED', created_at: '2026-02-10T11:30:00.000Z' },
    { id: 'y-antigo', status: 'YELLOW', created_at: '2026-02-10T08:00:00.000Z' },
    { id: 'r-antigo', status: 'RED', created_at: '2026-02-10T09:00:00.000Z' },
  ];

  it('vermelho antes de amarelo e, dentro da severidade, o mais antigo primeiro', () => {
    expect(sortTriageQueue(alerts).map((a) => a.id)).toEqual(['r-antigo', 'r-novo', 'y-antigo', 'y-novo']);
  });

  it('não muta o array original', () => {
    const copy = [...alerts];
    sortTriageQueue(alerts);
    expect(alerts).toEqual(copy);
  });
});

describe('openForLabel', () => {
  const agora = new Date('2026-02-10T12:00:00.000Z');

  it('menos de uma hora em minutos', () => {
    expect(openForLabel('2026-02-10T11:30:00.000Z', agora)).toBe('há 30min');
  });

  it('algumas horas no formato hXX', () => {
    expect(openForLabel('2026-02-10T09:15:00.000Z', agora)).toBe('há 2h45');
  });

  it('mais de um dia em dias', () => {
    expect(openForLabel('2026-02-08T12:00:00.000Z', agora)).toBe('há 2d');
  });
});
