import { describe, expect, it } from 'vitest';
import {
  classifyQueueItem,
  isFreeToReceiveOffers,
  isOfferExpired,
  offerCountdown,
  sortOpenQueue,
  unavailableReason,
  validateEscalationReason,
  type TriageAlertLike,
} from './nurseTriage';

const EU = 'nurse-1';
const OUTRA = 'nurse-2';
const AGORA = new Date('2026-02-10T12:00:00.000Z');

function alerta(overrides: Partial<TriageAlertLike> = {}): TriageAlertLike {
  return {
    status: 'YELLOW',
    attendance_status: 'PENDING',
    attended: false,
    assigned_nurse_id: null,
    offer_expires_at: null,
    in_analysis_by: null,
    escalated_at: null,
    created_at: '2026-02-10T11:00:00.000Z',
    sla_breached_at: null,
    ...overrides,
  };
}

describe('isOfferExpired', () => {
  it('sem oferta é tratada como expirada (vai para a fila aberta)', () => {
    expect(isOfferExpired(null, AGORA)).toBe(true);
  });
  it('janela no futuro ainda vale', () => {
    expect(isOfferExpired('2026-02-10T12:03:00.000Z', AGORA)).toBe(false);
  });
  it('janela no passado expirou', () => {
    expect(isOfferExpired('2026-02-10T11:59:00.000Z', AGORA)).toBe(true);
  });
});

describe('offerCountdown', () => {
  it('formata mm:ss', () => {
    expect(offerCountdown('2026-02-10T12:04:12.000Z', AGORA).label).toBe('4:12');
  });
  it('preenche o segundo com zero à esquerda', () => {
    expect(offerCountdown('2026-02-10T12:00:05.000Z', AGORA).label).toBe('0:05');
  });
  it('expirada quando o prazo passou', () => {
    const c = offerCountdown('2026-02-10T11:58:00.000Z', AGORA);
    expect(c.expired).toBe(true);
    expect(c.label).toBe('expirada');
  });
});

describe('classifyQueueItem', () => {
  it('sem dono → fila aberta', () => {
    expect(classifyQueueItem(alerta(), EU, AGORA)).toBe('OPEN');
  });

  it('oferecido a mim dentro da janela', () => {
    const a = alerta({ assigned_nurse_id: EU, offer_expires_at: '2026-02-10T12:04:00.000Z' });
    expect(classifyQueueItem(a, EU, AGORA)).toBe('OFFERED_TO_ME');
  });

  it('oferecido a outro, janela correndo → visível, mas de outro', () => {
    const a = alerta({ assigned_nurse_id: OUTRA, offer_expires_at: '2026-02-10T12:04:00.000Z' });
    expect(classifyQueueItem(a, EU, AGORA)).toBe('OFFERED_TO_OTHER');
  });

  it('oferta de outro JÁ VENCIDA volta para a fila aberta (nunca fica presa)', () => {
    const a = alerta({ assigned_nurse_id: OUTRA, offer_expires_at: '2026-02-10T11:50:00.000Z' });
    expect(classifyQueueItem(a, EU, AGORA)).toBe('OPEN');
  });

  it('lock manda mais que atribuição: travado por mim é "em análise"', () => {
    const a = alerta({ assigned_nurse_id: OUTRA, in_analysis_by: EU });
    expect(classifyQueueItem(a, EU, AGORA)).toBe('MINE_IN_ANALYSIS');
  });

  it('travado por outro', () => {
    expect(classifyQueueItem(alerta({ in_analysis_by: OUTRA }), EU, AGORA)).toBe('LOCKED_BY_OTHER');
  });

  it('escalado sai da fila da enfermagem', () => {
    expect(classifyQueueItem(alerta({ escalated_at: '2026-02-10T11:30:00.000Z' }), EU, AGORA)).toBeNull();
  });

  it('vermelho não entra na fila de oferta', () => {
    expect(classifyQueueItem(alerta({ status: 'RED' }), EU, AGORA)).toBeNull();
  });

  it('finalizado sai da fila', () => {
    expect(classifyQueueItem(alerta({ attendance_status: 'ATTENDED', attended: true }), EU, AGORA)).toBeNull();
  });
});

describe('sortOpenQueue', () => {
  it('atrasados primeiro; depois o mais antigo', () => {
    const rows = [
      { id: 'novo', created_at: '2026-02-10T11:50:00.000Z', sla_breached_at: null },
      { id: 'antigo', created_at: '2026-02-10T09:00:00.000Z', sla_breached_at: null },
      { id: 'atrasado', created_at: '2026-02-10T11:00:00.000Z', sla_breached_at: '2026-02-10T11:59:00.000Z' },
    ];
    expect(sortOpenQueue(rows).map((r) => r.id)).toEqual(['atrasado', 'antigo', 'novo']);
  });

  it('não muta o array original', () => {
    const rows = [{ created_at: '2026-02-10T11:00:00.000Z' }, { created_at: '2026-02-10T09:00:00.000Z' }];
    const copy = [...rows];
    sortOpenQueue(rows);
    expect(rows).toEqual(copy);
  });
});

describe('isFreeToReceiveOffers / unavailableReason', () => {
  const base = { onDuty: true, paused: false, activeLoad: 3, wipLimit: 5 };

  it('em plantão, sem pausa e abaixo do WIP → livre', () => {
    expect(isFreeToReceiveOffers(base)).toBe(true);
    expect(unavailableReason(base)).toBeNull();
  });

  it('fora de plantão não recebe oferta', () => {
    const s = { ...base, onDuty: false };
    expect(isFreeToReceiveOffers(s)).toBe(false);
    expect(unavailableReason(s)).toMatch(/não está de plantão/i);
  });

  it('pausado não recebe oferta', () => {
    const s = { ...base, paused: true };
    expect(isFreeToReceiveOffers(s)).toBe(false);
    expect(unavailableReason(s)).toMatch(/pausado/i);
  });

  it('no limite de WIP não recebe oferta', () => {
    const s = { ...base, activeLoad: 5 };
    expect(isFreeToReceiveOffers(s)).toBe(false);
    expect(unavailableReason(s)).toMatch(/limite de 5/);
  });
});

describe('validateEscalationReason', () => {
  it('vazio é recusado', () => {
    expect(validateEscalationReason('   ')).toMatch(/Descreva/);
  });
  it('curto demais é recusado', () => {
    expect(validateEscalationReason('piorou')).toMatch(/mínimo/);
  });
  it('justificativa adequada passa', () => {
    expect(validateEscalationReason('Paciente relatou piora da dor e febre.')).toBeNull();
  });
});
