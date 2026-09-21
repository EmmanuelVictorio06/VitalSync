/**
 * Conferência do cadastro de paciente (lib/patientReview.ts).
 *
 * O que estes testes protegem:
 *   - a conferência mostra os MESMOS rótulos do prontuário (se alguém mudar um
 *     rótulo em patientInfo/studyVariables, as duas telas mudam juntas);
 *   - campo vazio é detectado — inclusive as variáveis do estudo, que é o caso
 *     que hoje passa batido no cadastro;
 *   - obrigatório vazio/ inválido bloqueia o "Confirmar cadastro".
 */
import { describe, expect, it } from 'vitest';
import { patientInfoRows } from './patientInfo';
import { EMPTY_VALUE, studyVariableEntries } from './studyVariables';
import {
  DISCHARGE_BEFORE_SURGERY_ERROR,
  asStudyVariables,
  buildReviewSections,
  countMissingStudyVariables,
  registrationProblems,
  reviewComorbidities,
  type PatientRegistrationForm,
  type RegistrationLookups,
} from './patientReview';

const lookups: RegistrationLookups = {
  surgeryTypes: [{ id: 'st1', name: 'Artroplastia de Quadril' }],
  hospitals: [{ id: 'h1', name: 'Hospital Santa Vida' }],
  teams: [{ id: 't1', number: 1, surgeonName: 'Dra. Ana Souza' }],
};

/** Cadastro completo — nada pode aparecer como "—". CPF válido de teste. */
const completo: PatientRegistrationForm = {
  name: 'Maria Aparecida',
  cpf: '529.982.247-25',
  birthDate: '1968-03-11',
  phone: '41999990001',
  surgeryTypeId: 'st1',
  surgeryDate: '2026-09-17',
  dischargeDate: '2026-09-19',
  hospitalId: 'h1',
  teamId: 't1',
  isTest: false,
  medicalRecordSummary: '<p>Histórico relevante</p>',
  sex: 'F',
  weightKg: '111',
  heightCm: '158',
  comorbidities: '<ul><li>Diabetes tipo 2</li><li>Hipertensão</li></ul>',
  lengthOfStayDays: '7',
  alternativePhone: '41900000098',
  tcleAcceptedAt: '2026-09-10',
};

const vazio: PatientRegistrationForm = {
  name: '', cpf: '', birthDate: '', phone: '', surgeryTypeId: '', surgeryDate: '', dischargeDate: '',
  hospitalId: '', teamId: '', isTest: false, medicalRecordSummary: '', sex: '', weightKg: '', heightCm: '',
  comorbidities: '', lengthOfStayDays: '', alternativePhone: '', tcleAcceptedAt: '',
};

const secao = (form: PatientRegistrationForm, key: string) =>
  buildReviewSections(form, lookups).find((s) => s.key === key)!;
const valor = (form: PatientRegistrationForm, key: string, row: string) =>
  secao(form, key).rows.find((r) => r.key === row)?.value;

describe('buildReviewSections — cadastro completo', () => {
  it('não deixa nenhum campo em branco', () => {
    const brancos = buildReviewSections(completo, lookups)
      .flatMap((s) => s.rows)
      .filter((r) => r.missing)
      .map((r) => r.label);
    expect(brancos, `campos em branco com cadastro completo: ${brancos.join(', ')}`).toEqual([]);
  });

  it('nada bloqueia o Confirmar', () => {
    expect(registrationProblems(completo)).toEqual([]);
    expect(buildReviewSections(completo, lookups).flatMap((s) => s.rows).some((r) => r.blocking)).toBe(false);
  });

  it('resolve id → nome legível (cirurgia, hospital, equipe e cirurgião)', () => {
    expect(valor(completo, 'patient', 'surgeryType')).toBe('Artroplastia de Quadril');
    expect(valor(completo, 'patient', 'hospital')).toBe('Hospital Santa Vida');
    expect(valor(completo, 'patient', 'team')).toBe('Equipe 01');
    expect(valor(completo, 'patient', 'surgeon')).toBe('Dra. Ana Souza');
  });

  it('mostra o CPF formatado (não está no prontuário, mas é digitado aqui)', () => {
    expect(valor(completo, 'patient', 'cpf')).toBe('529.982.247-25');
  });

  it('mostra as 7 variáveis do estudo, com o IMC derivado de peso/altura', () => {
    const study = secao(completo, 'study');
    expect(study.rows.map((r) => r.label)).toEqual([
      'Sexo', 'Peso', 'Altura', 'IMC', 'Tempo de internação', 'Contato alternativo', 'TCLE assinado em',
    ]);
    expect(valor(completo, 'study', 'bmi')).toBe('44,5 kg/m²');
  });
});

describe('mesma fonte de rótulos do prontuário', () => {
  it('as linhas do paciente saem de patientInfoRows (menos as que não existem no cadastro)', () => {
    const doProntuario = patientInfoRows({
      patient: null,
      teamNumber: null,
      surgeonName: null,
      monitoringDay: null,
    })
      .filter((r) => r.key !== 'monitoringDay')
      .map((r) => r.label);
    const daConferencia = secao(completo, 'patient').rows.filter((r) => r.key !== 'cpf').map((r) => r.label);
    expect(daConferencia).toEqual(doProntuario);
  });

  it('"Dia de monitoramento" não aparece (só existe depois da 1ª medição)', () => {
    expect(secao(completo, 'patient').rows.map((r) => r.key)).not.toContain('monitoringDay');
  });

  it('as variáveis do estudo saem de studyVariableEntries', () => {
    const esperado = studyVariableEntries(asStudyVariables(completo));
    expect(secao(completo, 'study').rows.map((r) => ({ key: r.key, label: r.label, value: r.value }))).toEqual(esperado);
  });
});

describe('destaque de campo vazio', () => {
  it('formulário vazio marca tudo como ausente', () => {
    const rows = buildReviewSections(vazio, lookups).flatMap((s) => s.rows);
    expect(rows.every((r) => r.missing)).toBe(true);
    expect(rows.every((r) => r.value === EMPTY_VALUE)).toBe(true);
  });

  it('variável do estudo em branco é detectada mesmo com o obrigatório completo', () => {
    const semEstudo: PatientRegistrationForm = {
      ...completo, sex: '', weightKg: '', heightCm: '', lengthOfStayDays: '', alternativePhone: '', tcleAcceptedAt: '',
    };
    const sections = buildReviewSections(semEstudo, lookups);
    // 7 variáveis (o IMC também cai, por depender de peso e altura).
    expect(countMissingStudyVariables(sections)).toBe(7);
    // …e nenhuma delas bloqueia: são opcionais, só precisam ser vistas.
    expect(sections.flatMap((s) => s.rows).some((r) => r.blocking)).toBe(false);
    expect(registrationProblems(semEstudo)).toEqual([]);
  });

  it('obrigatório vazio marca a linha como bloqueante', () => {
    const semNome = { ...completo, name: '' };
    const linha = secao(semNome, 'patient').rows.find((r) => r.key === 'name');
    expect(linha?.missing).toBe(true);
    expect(linha?.blocking).toBe(true);
  });

  it('cada linha aponta para o campo do formulário que a preenche', () => {
    const rows = buildReviewSections(completo, lookups).flatMap((s) => s.rows);
    const porChave = Object.fromEntries(rows.map((r) => [r.key, r.field]));
    expect(porChave.age).toBe('birthDate'); // idade é derivada da data de nascimento
    expect(porChave.bmi).toBe('weightKg'); // IMC é derivado: manda para o peso
    expect(porChave.surgeon).toBe('teamId'); // cirurgião vem da equipe escolhida
    expect(rows.every((r) => r.field in vazio)).toBe(true);
  });
});

describe('registrationProblems', () => {
  it('lista todos os obrigatórios vazios de uma vez', () => {
    expect(registrationProblems(vazio).map((p) => p.field)).toEqual([
      'name', 'cpf', 'phone', 'birthDate', 'surgeryTypeId', 'hospitalId', 'surgeryDate', 'dischargeDate', 'teamId',
    ]);
  });

  it('acusa CPF inválido sem duplicar o "não preenchido"', () => {
    const problemas = registrationProblems({ ...completo, cpf: '111.111.111-11' });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.message).toContain('CPF inválido');
  });

  it('acusa alta anterior à cirurgia (mesmo dia é válido)', () => {
    const invertido = { ...completo, surgeryDate: '2026-09-19', dischargeDate: '2026-09-17' };
    expect(registrationProblems(invertido)[0]?.message).toBe(DISCHARGE_BEFORE_SURGERY_ERROR);
    expect(registrationProblems({ ...completo, dischargeDate: completo.surgeryDate })).toEqual([]);
  });

  it('não reclama de data fora de ordem quando só uma foi preenchida', () => {
    const so_alta = { ...completo, surgeryDate: '' };
    expect(registrationProblems(so_alta).map((p) => p.field)).toEqual(['surgeryDate']);
  });
});

describe('comorbidades e conversão numérica', () => {
  it('mostra a lista como será gravada (texto puro, um item por <li>)', () => {
    expect(reviewComorbidities(completo)).toEqual(['Diabetes tipo 2', 'Hipertensão']);
    expect(reviewComorbidities({ ...completo, comorbidities: '' })).toEqual([]);
  });

  it('aceita vírgula decimal, como o submit faz ao montar o payload', () => {
    expect(asStudyVariables({ ...completo, weightKg: '72,5' }).weight_kg).toBe(72.5);
    expect(asStudyVariables({ ...completo, weightKg: '' }).weight_kg).toBeNull();
    expect(asStudyVariables({ ...completo, weightKg: 'abc' }).weight_kg).toBeNull();
  });
});
