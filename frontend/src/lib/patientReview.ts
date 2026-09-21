/**
 * Conferência do cadastro de paciente — modelo PURO da tela de revisão.
 *
 * Por que existe: antes de efetivar o cadastro o usuário precisa rever o que
 * digitou, com os MESMOS rótulos e a MESMA formatação que verá depois no
 * "Prontuário do paciente" do Detalhes do Alerta. Por isso este módulo não
 * inventa rótulo nenhum: ele monta o paciente no formato do prontuário e
 * delega a `patientInfoRows` (lib/patientInfo.ts) e `studyVariableEntries`
 * (lib/studyVariables.ts). Mudar um rótulo lá muda nos dois lugares.
 *
 * Só lógica (sem JSX) para caber nos testes do projeto, que rodam sem jsdom.
 * A renderização fica em components/PatientReviewModal.tsx.
 */
import { isDischargeAfterSurgery } from '@vitalsync/shared';
import { formatCpf, validateCpf } from './cpfUtils';
import { parseComorbidities } from './comorbidities';
import { patientInfoRows } from './patientInfo';
import { EMPTY_VALUE, studyVariableEntries } from './studyVariables';

/** Estado do formulário de cadastro (PatientRegisterPage). */
export interface PatientRegistrationForm {
  name: string;
  cpf: string;
  birthDate: string;
  phone: string;
  surgeryTypeId: string;
  surgeryDate: string;
  dischargeDate: string;
  hospitalId: string;
  teamId: string;
  isTest: boolean;
  medicalRecordSummary: string;
  sex: '' | 'M' | 'F';
  weightKg: string;
  heightCm: string;
  comorbidities: string;
  lengthOfStayDays: string;
  alternativePhone: string;
  tcleAcceptedAt: string;
}

export type RegistrationField = keyof PatientRegistrationForm;

/** Listas já carregadas pela página, para resolver id → nome legível. */
export interface RegistrationLookups {
  surgeryTypes: Array<{ id: string; name: string }>;
  hospitals: Array<{ id: string; name: string }>;
  /** Equipes que o usuário pode escolher, com número e cirurgião responsável. */
  teams: Array<{ id: string; number: number; surgeonName: string | null }>;
}

/**
 * Mensagem única (submit + feedback no campo) — `hospital_discharge_date` é o
 * marco zero do monitoramento, então essa ordem precisa estar certa.
 */
export const DISCHARGE_BEFORE_SURGERY_ERROR =
  'A data da alta hospitalar não pode ser anterior à data da cirurgia.';

/**
 * Campos obrigatórios, com o rótulo EXATO do formulário — é para lá que o botão
 * "Corrigir" manda o usuário, então o texto precisa ser o que ele vê na tela.
 */
const REQUIRED_FIELDS: ReadonlyArray<{ field: RegistrationField; label: string }> = [
  { field: 'name', label: 'Nome do paciente' },
  { field: 'cpf', label: 'CPF' },
  { field: 'phone', label: 'Telefone (WhatsApp)' },
  { field: 'birthDate', label: 'Data de nascimento' },
  { field: 'surgeryTypeId', label: 'Tipo de cirurgia' },
  { field: 'hospitalId', label: 'Hospital' },
  { field: 'surgeryDate', label: 'Data da cirurgia' },
  { field: 'dischargeDate', label: 'Data da alta hospitalar' },
  { field: 'teamId', label: 'Equipe responsável' },
];

export interface RegistrationProblem {
  field: RegistrationField;
  label: string;
  message: string;
}

/**
 * Tudo que IMPEDE o cadastro: obrigatório vazio, CPF inválido e datas fora de
 * ordem. Mesmas regras que o submit já aplicava — aqui elas viram lista, para a
 * conferência mostrar todas de uma vez em vez de um toast por vez.
 * O servidor revalida (create-patient); isto é UX.
 */
export function registrationProblems(form: PatientRegistrationForm): RegistrationProblem[] {
  const problems: RegistrationProblem[] = [];

  for (const { field, label } of REQUIRED_FIELDS) {
    if (!String(form[field] ?? '').trim()) {
      problems.push({ field, label, message: 'Não preenchido.' });
    }
  }

  if (form.cpf.trim() && !validateCpf(form.cpf)) {
    problems.push({ field: 'cpf', label: 'CPF', message: 'CPF inválido. Verifique os dígitos.' });
  }

  if (form.surgeryDate && form.dischargeDate && !isDischargeAfterSurgery(form.surgeryDate, form.dischargeDate)) {
    problems.push({
      field: 'dischargeDate',
      label: 'Data da alta hospitalar',
      message: DISCHARGE_BEFORE_SURGERY_ERROR,
    });
  }

  return problems;
}

/** Linha da conferência: valor formatado + para onde o "Corrigir" leva. */
export interface ReviewRow {
  key: string;
  label: string;
  value: string;
  /** Campo do formulário a focar ao corrigir. */
  field: RegistrationField;
  /** Valor ausente (caiu no "—"). */
  missing: boolean;
  /** Ausente ou inválido E obrigatório — bloqueia o "Confirmar cadastro". */
  blocking: boolean;
}

export interface ReviewSection {
  key: string;
  title: string;
  rows: ReviewRow[];
}

/** Campo do formulário por trás de cada linha do prontuário. */
const INFO_ROW_FIELD: Record<string, RegistrationField> = {
  name: 'name',
  age: 'birthDate',
  phone: 'phone',
  surgeryType: 'surgeryTypeId',
  hospital: 'hospitalId',
  surgeryDate: 'surgeryDate',
  dischargeDate: 'dischargeDate',
  team: 'teamId',
  surgeon: 'teamId',
};

/** Campo do formulário por trás de cada variável do estudo (IMC é derivado). */
const STUDY_ROW_FIELD: Record<string, RegistrationField> = {
  sex: 'sex',
  weight: 'weightKg',
  height: 'heightCm',
  bmi: 'weightKg',
  lengthOfStay: 'lengthOfStayDays',
  alternativePhone: 'alternativePhone',
  tcle: 'tcleAcceptedAt',
};

/**
 * "Dia de monitoramento" sai da conferência: não é campo digitado e só existe
 * depois que o paciente começa a medir. Filtrado pela chave, não pelo rótulo.
 */
const INFO_ROWS_FORA_DO_CADASTRO = new Set(['monitoringDay']);

function byId<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((item) => item.id === id);
}

/** Converte o formulário no formato que o prontuário já sabe exibir. */
function asPatientInfo(form: PatientRegistrationForm, lookups: RegistrationLookups) {
  const surgeryType = byId(lookups.surgeryTypes, form.surgeryTypeId);
  const hospital = byId(lookups.hospitals, form.hospitalId);
  return {
    name: form.name.trim(),
    birth_date: form.birthDate || null,
    phone: form.phone || null,
    surgery_type: surgeryType ? { name: surgeryType.name } : null,
    hospital: hospital ? { name: hospital.name } : null,
    surgery_date: form.surgeryDate || null,
    hospital_discharge_date: form.dischargeDate || null,
  };
}

/**
 * Variáveis do estudo no formato que `studyVariableEntries` espera — a mesma
 * conversão texto → número que o submit faz ao montar o payload.
 */
export function asStudyVariables(form: PatientRegistrationForm) {
  const num = (v: string): number | null => {
    if (!v.trim()) return null;
    const parsed = Number(v.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    sex: form.sex || null,
    weight_kg: num(form.weightKg),
    height_cm: num(form.heightCm),
    length_of_stay_days: num(form.lengthOfStayDays),
    alternative_phone: form.alternativePhone || null,
    tcle_accepted_at: form.tcleAcceptedAt || null,
  };
}

/**
 * Seções da conferência, na mesma ordem e com os mesmos rótulos do prontuário.
 * `blocking` marca o que impede o envio; `missing` marca o que só está vazio
 * (opcional) — é este segundo caso que hoje passa batido nas variáveis do estudo.
 */
export function buildReviewSections(
  form: PatientRegistrationForm,
  lookups: RegistrationLookups,
): ReviewSection[] {
  const problemFields = new Set(registrationProblems(form).map((p) => p.field));
  const team = byId(lookups.teams, form.teamId);

  const row = (key: string, label: string, value: string, field: RegistrationField): ReviewRow => ({
    key,
    label,
    value,
    field,
    missing: value === EMPTY_VALUE,
    blocking: problemFields.has(field),
  });

  const info = patientInfoRows({
    patient: asPatientInfo(form, lookups),
    teamNumber: team?.number ?? null,
    surgeonName: team?.surgeonName ?? null,
    monitoringDay: null,
  })
    .filter((r) => !INFO_ROWS_FORA_DO_CADASTRO.has(r.key))
    .map((r) => row(r.key, r.label, r.value, INFO_ROW_FIELD[r.key] ?? 'name'));

  // CPF não aparece no prontuário (dado protegido: o banco só guarda hash e
  // cifra), mas é digitado aqui e é o erro de digitação mais caro — sem ele o
  // paciente não consegue abrir o próprio link. Entra logo depois do nome.
  info.splice(1, 0, row('cpf', 'CPF', form.cpf.trim() ? formatCpf(form.cpf) : EMPTY_VALUE, 'cpf'));

  const study = studyVariableEntries(asStudyVariables(form)).map((e) =>
    row(e.key, e.label, e.value, STUDY_ROW_FIELD[e.key] ?? 'sex'),
  );

  return [
    { key: 'patient', title: 'Prontuário do paciente', rows: info },
    { key: 'study', title: 'Variáveis clínicas do estudo', rows: study },
  ];
}

/** Comorbidades como serão persistidas (texto puro), para conferir na revisão. */
export function reviewComorbidities(form: PatientRegistrationForm): string[] {
  return parseComorbidities(form.comorbidities);
}

/** Quantas variáveis do estudo ficaram vazias — alimenta o aviso da conferência. */
export function countMissingStudyVariables(sections: ReviewSection[]): number {
  return sections.find((s) => s.key === 'study')?.rows.filter((r) => r.missing).length ?? 0;
}
