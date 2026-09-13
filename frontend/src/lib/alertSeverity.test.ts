import { describe, expect, it } from 'vitest';
import { Role } from '@vitalsync/shared';
import {
  canFinalizeAlert,
  effectiveSeverity,
  isEscalated,
  isResolvedAlert,
  isWithNursing,
  ownsDoctorQueue,
  type SeverityAlertLike,
} from './alertSeverity';

const EU = 'medico-1';
const OUTRO = 'medico-2';

function alerta(overrides: Partial<SeverityAlertLike> = {}): SeverityAlertLike {
  return {
    status: 'YELLOW',
    escalated_at: null,
    attendance_status: 'PENDING',
    attended: false,
    in_analysis_by: null,
    ...overrides,
  };
}

describe('effectiveSeverity', () => {
  it('amarelo não escalado continua amarelo', () => {
    expect(effectiveSeverity(alerta())).toBe('YELLOW');
  });

  it('vermelho é vermelho', () => {
    expect(effectiveSeverity(alerta({ status: 'RED' }))).toBe('RED');
  });

  it('amarelo ESCALADO vale como vermelho sem mexer em status', () => {
    const a = alerta({ escalated_at: '2026-08-25T07:19:01.000Z' });
    expect(effectiveSeverity(a)).toBe('RED');
    // a severidade clínica gravada permanece intocada (0064/0077)
    expect(a.status).toBe('YELLOW');
  });

  it('escalonamento automático de 8h também conta como vermelho', () => {
    // o sweep grava escalated_at com escalated_by nulo (decisão do sistema)
    expect(effectiveSeverity(alerta({ escalated_at: '2026-08-25T07:21:08.000Z' }))).toBe('RED');
  });

  it('verde é verde', () => {
    expect(effectiveSeverity(alerta({ status: 'GREEN' }))).toBe('GREEN');
  });
});

describe('isEscalated', () => {
  it('distingue escalado de não escalado', () => {
    expect(isEscalated(alerta())).toBe(false);
    expect(isEscalated(alerta({ escalated_at: '2026-08-25T07:19:01.000Z' }))).toBe(true);
  });
});

describe('isResolvedAlert', () => {
  it('atendido e ignorado são finalizados', () => {
    expect(isResolvedAlert(alerta({ attendance_status: 'ATTENDED' }))).toBe(true);
    expect(isResolvedAlert(alerta({ attendance_status: 'IGNORED' }))).toBe(true);
  });

  it('pendente e em análise não são', () => {
    expect(isResolvedAlert(alerta({ attendance_status: 'PENDING' }))).toBe(false);
    expect(isResolvedAlert(alerta({ attendance_status: 'IN_ANALYSIS' }))).toBe(false);
  });

  it('a flag attended também finaliza', () => {
    expect(isResolvedAlert(alerta({ attendance_status: 'PENDING', attended: true }))).toBe(true);
  });
});

describe('ownsDoctorQueue', () => {
  it('cirurgião e associado têm fila de médico', () => {
    expect(ownsDoctorQueue(Role.SURGEON)).toBe(true);
    expect(ownsDoctorQueue(Role.ASSOCIATE)).toBe(true);
  });

  it('admin, gerente, enfermeiro e suporte não', () => {
    expect(ownsDoctorQueue(Role.ADM)).toBe(false);
    expect(ownsDoctorQueue(Role.MANAGER)).toBe(false);
    expect(ownsDoctorQueue(Role.NURSE)).toBe(false);
    expect(ownsDoctorQueue(Role.SUPPORT)).toBe(false);
    expect(ownsDoctorQueue(null)).toBe(false);
    expect(ownsDoctorQueue(undefined)).toBe(false);
  });
});

describe('isWithNursing', () => {
  it('amarelo pendente NÃO é do médico', () => {
    expect(isWithNursing(alerta(), Role.SURGEON, EU)).toBe(true);
    expect(isWithNursing(alerta(), Role.ASSOCIATE, EU)).toBe(true);
  });

  it('depois de escalado passa a ser do médico', () => {
    const escalado = alerta({ escalated_at: '2026-08-25T07:19:01.000Z' });
    expect(isWithNursing(escalado, Role.SURGEON, EU)).toBe(false);
  });

  it('vermelho sempre é do médico', () => {
    expect(isWithNursing(alerta({ status: 'RED' }), Role.SURGEON, EU)).toBe(false);
  });

  it('amarelo já finalizado é histórico, não fila da enfermagem', () => {
    expect(isWithNursing(alerta({ attendance_status: 'ATTENDED' }), Role.SURGEON, EU)).toBe(false);
    expect(isWithNursing(alerta({ attendance_status: 'IGNORED' }), Role.SURGEON, EU)).toBe(false);
  });

  it('amarelo que EU mesmo travei continua meu (não fica preso sem dono)', () => {
    const meu = alerta({ attendance_status: 'IN_ANALYSIS', in_analysis_by: EU });
    expect(isWithNursing(meu, Role.SURGEON, EU)).toBe(false);
  });

  it('amarelo travado por OUTRO segue sendo da enfermagem para mim', () => {
    const dele = alerta({ attendance_status: 'IN_ANALYSIS', in_analysis_by: OUTRO });
    expect(isWithNursing(dele, Role.SURGEON, EU)).toBe(true);
  });

  it('admin e gerente enxergam a fila inteira como hoje', () => {
    expect(isWithNursing(alerta(), Role.ADM, EU)).toBe(false);
    expect(isWithNursing(alerta(), Role.MANAGER, EU)).toBe(false);
  });

  it('enfermeiro não é afetado (tem a fila dele no painel de enfermagem)', () => {
    expect(isWithNursing(alerta(), Role.NURSE, EU)).toBe(false);
  });

  it('sem viewerId, o amarelo pendente segue sendo da enfermagem', () => {
    expect(isWithNursing(alerta(), Role.SURGEON, null)).toBe(true);
  });
});

describe('canFinalizeAlert', () => {
  const ESCALADO = alerta({ status: 'YELLOW', escalated_at: '2026-09-13T09:00:00Z' });
  const VERMELHO = alerta({ status: 'RED' });
  const AMARELO = alerta();

  it('enfermeiro conclui amarelo não escalado', () => {
    expect(canFinalizeAlert(AMARELO, Role.NURSE)).toBe(true);
  });

  it('enfermeiro NÃO conclui vermelho', () => {
    expect(canFinalizeAlert(VERMELHO, Role.NURSE)).toBe(false);
  });

  it('enfermeiro NÃO conclui amarelo já escalado ao médico', () => {
    // O furo que a 0080 fecha: status continua YELLOW, mas a severidade
    // efetiva é RED e o caso é fila do médico.
    expect(ESCALADO.status).toBe('YELLOW');
    expect(canFinalizeAlert(ESCALADO, Role.NURSE)).toBe(false);
  });

  it('médicos e admin não são afetados', () => {
    for (const papel of [Role.SURGEON, Role.ASSOCIATE, Role.ADM, Role.MANAGER]) {
      expect(canFinalizeAlert(ESCALADO, papel), `papel afetado: ${papel}`).toBe(true);
      expect(canFinalizeAlert(VERMELHO, papel), `papel afetado: ${papel}`).toBe(true);
    }
  });

  it('sem papel definido não restringe (a RPC é a autoridade)', () => {
    expect(canFinalizeAlert(VERMELHO, null)).toBe(true);
    expect(canFinalizeAlert(VERMELHO, undefined)).toBe(true);
  });
});
