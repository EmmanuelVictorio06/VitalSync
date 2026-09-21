/**
 * Variáveis clínicas do estudo (protocolo 5.9 / 5.6.4 / 5.14 — migration 0052)
 * — FONTE ÚNICA do de-para "rótulo PT-BR ↔ coluna de `patients` ↔ formatação".
 *
 * Por que existe: o painel "Prontuário do paciente" do detalhe do alerta é o
 * único lugar do app que exibe essas variáveis, e o de-para estava inline no
 * componente. Um campo que deixasse de vir na query aparecia como "—",
 * indistinguível de "não preenchido no cadastro" — falha silenciosa.
 *
 * Aqui cada variável declara as COLUNAS de onde vem. `STUDY_VARIABLE_COLUMNS`
 * é o que a query do alerta (`ALERT_SELECT`, em services/alertService.ts) usa
 * para montar o select, então UI e query não podem divergir: acrescentar uma
 * variável aqui já a faz ser selecionada, e o teste de contrato
 * (studyVariables.test.ts) quebra se alguma coluna sair do select.
 *
 * NÃO duplicar este de-para: o formulário de cadastro/edição escreve as mesmas
 * colunas (ver PatientRegisterPage/PatientEditModal + Edge Functions
 * create-patient/update-patient).
 */
import { formatCivilDate, formatPhoneBR } from '@vitalsync/shared';

/** Placeholder de valor ausente — mesmo caractere usado no resto do detalhe. */
export const EMPTY_VALUE = '—';

/** Subconjunto de `patients` que as variáveis do estudo leem. */
export interface StudyVariablesSource {
  sex?: 'M' | 'F' | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  length_of_stay_days?: number | null;
  alternative_phone?: string | null;
  tcle_accepted_at?: string | null;
}

export type StudyVariableColumn = keyof StudyVariablesSource;

export interface StudyVariableSpec {
  /** Identificador estável (usado nos testes; não aparece na UI). */
  key: string;
  /** Rótulo exibido no grid. */
  label: string;
  /** Colunas de `patients` que alimentam este campo. Nunca vazio. */
  columns: readonly StudyVariableColumn[];
  /** Formatação para exibição; devolve EMPTY_VALUE quando falta dado. */
  format: (p: StudyVariablesSource) => string;
}

/** IMC = peso (kg) / altura (m)². `null` quando falta um dos dois valores. */
export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (weightKg == null || heightCm == null || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

export const sexLabel = (sex: 'M' | 'F' | null | undefined): string =>
  sex === 'M' ? 'Masculino' : sex === 'F' ? 'Feminino' : EMPTY_VALUE;

/**
 * Ordem = ordem de exibição no grid. O IMC é derivado (não tem coluna
 * própria): declara as duas colunas de que depende.
 */
export const STUDY_VARIABLES: readonly StudyVariableSpec[] = [
  {
    key: 'sex',
    label: 'Sexo',
    columns: ['sex'],
    format: (p) => sexLabel(p.sex),
  },
  {
    key: 'weight',
    label: 'Peso',
    columns: ['weight_kg'],
    format: (p) => (p.weight_kg != null ? `${p.weight_kg} kg` : EMPTY_VALUE),
  },
  {
    key: 'height',
    label: 'Altura',
    columns: ['height_cm'],
    format: (p) => (p.height_cm != null ? `${p.height_cm} cm` : EMPTY_VALUE),
  },
  {
    key: 'bmi',
    label: 'IMC',
    columns: ['weight_kg', 'height_cm'],
    format: (p) => {
      const value = bmi(p.weight_kg, p.height_cm);
      // Vírgula decimal: o resto da tela é pt-BR ("37,8 °C", "1,58 m").
      return value == null ? EMPTY_VALUE : `${value.toFixed(1).replace('.', ',')} kg/m²`;
    },
  },
  {
    key: 'lengthOfStay',
    label: 'Tempo de internação',
    columns: ['length_of_stay_days'],
    format: (p) => (p.length_of_stay_days != null ? `${p.length_of_stay_days} dias` : EMPTY_VALUE),
  },
  {
    key: 'alternativePhone',
    label: 'Contato alternativo',
    columns: ['alternative_phone'],
    format: (p) => (p.alternative_phone ? formatPhoneBR(p.alternative_phone) : EMPTY_VALUE),
  },
  {
    key: 'tcle',
    label: 'TCLE assinado em',
    columns: ['tcle_accepted_at'],
    format: (p) => (p.tcle_accepted_at ? formatCivilDate(p.tcle_accepted_at) : EMPTY_VALUE),
  },
] as const;

/**
 * Colunas de `patients` que a query do alerta PRECISA selecionar para a seção
 * não cair em "—". Deduplicado, na ordem em que aparecem nas variáveis.
 */
export const STUDY_VARIABLE_COLUMNS: readonly StudyVariableColumn[] = [
  ...new Set(STUDY_VARIABLES.flatMap((v) => v.columns)),
];

/** Uma variável já formatada, com a chave estável de `STUDY_VARIABLES`. */
export interface StudyVariableEntry {
  key: string;
  label: string;
  value: string;
}

/**
 * Variáveis formatadas para exibição. A conferência do cadastro usa `key` para
 * saber a qual campo do formulário mandar o usuário de volta.
 */
export function studyVariableEntries(patient: StudyVariablesSource | null | undefined): StudyVariableEntry[] {
  const source = patient ?? {};
  return STUDY_VARIABLES.map((v) => ({ key: v.key, label: v.label, value: v.format(source) }));
}

/** Linhas [rótulo, valor] prontas para o `DGrid` do detalhe do alerta. */
export function studyVariableRows(patient: StudyVariablesSource | null | undefined): Array<[string, string]> {
  return studyVariableEntries(patient).map((e) => [e.label, e.value]);
}
