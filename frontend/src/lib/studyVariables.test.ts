/**
 * Rede de regressão da seção "Variáveis clínicas do estudo" (detalhe do alerta).
 *
 * O bug que estes testes protegem: os campos apareciam como "—" e não havia
 * como distinguir "não preenchido no cadastro" de "a query parou de trazer a
 * coluna". Aqui cada variável tem origem declarada, e o teste de contrato
 * quebra alto se alguma coluna sair do select do alertService.
 */
import { describe, expect, it } from 'vitest';
import { ALERT_SELECT } from '../services/alertService';
import {
  EMPTY_VALUE,
  STUDY_VARIABLES,
  STUDY_VARIABLE_COLUMNS,
  bmi,
  sexLabel,
  studyVariableRows,
  type StudyVariablesSource,
} from './studyVariables';

/** Paciente com TODAS as variáveis do estudo preenchidas (espelha o paciente
 *  fictício de supabase/_scripts/dev_paciente_variaveis_estudo.sql). */
const preenchido: StudyVariablesSource = {
  sex: 'F',
  weight_kg: 111,
  height_cm: 158,
  length_of_stay_days: 7,
  alternative_phone: '41900000098',
  tcle_accepted_at: '2026-09-10',
};

describe('STUDY_VARIABLES — origem de cada variável', () => {
  it('toda variável declara rótulo e ao menos uma coluna de origem', () => {
    expect(STUDY_VARIABLES.length).toBeGreaterThan(0);
    for (const v of STUDY_VARIABLES) {
      expect(v.label.trim(), `variável ${v.key} sem rótulo`).not.toBe('');
      expect(v.columns.length, `variável ${v.key} sem coluna de origem`).toBeGreaterThan(0);
    }
  });

  it('as chaves são únicas (o DGrid usa o rótulo como key)', () => {
    expect(new Set(STUDY_VARIABLES.map((v) => v.key)).size).toBe(STUDY_VARIABLES.length);
    expect(new Set(STUDY_VARIABLES.map((v) => v.label)).size).toBe(STUDY_VARIABLES.length);
  });

  it('STUDY_VARIABLE_COLUMNS é a união deduplicada das colunas declaradas', () => {
    const uniao = new Set(STUDY_VARIABLES.flatMap((v) => v.columns));
    expect([...STUDY_VARIABLE_COLUMNS].sort()).toEqual([...uniao].sort());
    expect(STUDY_VARIABLE_COLUMNS.length).toBe(uniao.size);
  });

  it('cobre as 7 variáveis do protocolo 5.9/5.6.4/5.14 (migration 0052)', () => {
    expect(STUDY_VARIABLES.map((v) => v.key)).toEqual([
      'sex', 'weight', 'height', 'bmi', 'lengthOfStay', 'alternativePhone', 'tcle',
    ]);
  });
});

describe('contrato com a query do alerta', () => {
  /** Nomes de coluna pedidos no select, como tokens isolados. */
  const tokens = new Set(ALERT_SELECT.split(/[^A-Za-z0-9_]+/).filter(Boolean));

  it('ALERT_SELECT seleciona TODA coluna de que as variáveis dependem', () => {
    // Falha alto: se uma coluna sair do select, o campo viraria "—" em silêncio.
    for (const coluna of STUDY_VARIABLE_COLUMNS) {
      expect(
        tokens.has(coluna),
        `ALERT_SELECT não traz a coluna "${coluna}" — a variável do estudo cairia em "—"`,
      ).toBe(true);
    }
  });

  it('ALERT_SELECT continua trazendo o paciente e o resumo do prontuário', () => {
    expect(ALERT_SELECT).toContain('patient:patients(');
    expect(ALERT_SELECT).toContain('medical_record_summary');
    expect(ALERT_SELECT).toContain('comorbidities');
  });
});

describe('studyVariableRows — paciente com dados preenchidos', () => {
  const linhas = studyVariableRows(preenchido);
  const valor = (rotulo: string) => linhas.find(([k]) => k === rotulo)?.[1];

  it('nenhuma variável fica em "—"', () => {
    const vazias = linhas.filter(([, v]) => v === EMPTY_VALUE).map(([k]) => k);
    expect(vazias, `variáveis em branco com dado preenchido: ${vazias.join(', ')}`).toEqual([]);
  });

  it('formata cada variável como a tela espera', () => {
    expect(valor('Sexo')).toBe('Feminino');
    expect(valor('Peso')).toBe('111 kg');
    expect(valor('Altura')).toBe('158 cm');
    expect(valor('IMC')).toBe('44,5 kg/m²'); // vírgula decimal (pt-BR)
    expect(valor('Tempo de internação')).toBe('7 dias');
    expect(valor('Contato alternativo')).toBe('(41) 90000-0098');
    expect(valor('TCLE assinado em')).toBe('10/09/2026');
  });

  it('devolve uma linha por variável, na ordem declarada', () => {
    expect(linhas.map(([k]) => k)).toEqual(STUDY_VARIABLES.map((v) => v.label));
  });
});

describe('studyVariableRows — paciente sem os dados', () => {
  it('cai em "—" quando o cadastro não preencheu (e não quebra com null)', () => {
    for (const patient of [null, undefined, {} as StudyVariablesSource]) {
      const linhas = studyVariableRows(patient);
      expect(linhas.length).toBe(STUDY_VARIABLES.length);
      expect(linhas.every(([, v]) => v === EMPTY_VALUE)).toBe(true);
    }
  });

  it('IMC exige peso E altura', () => {
    const so_peso = studyVariableRows({ weight_kg: 80 }).find(([k]) => k === 'IMC')?.[1];
    const so_altura = studyVariableRows({ height_cm: 170 }).find(([k]) => k === 'IMC')?.[1];
    expect(so_peso).toBe(EMPTY_VALUE);
    expect(so_altura).toBe(EMPTY_VALUE);
  });
});

describe('bmi / sexLabel', () => {
  it('calcula IMC = peso / altura²', () => {
    expect(bmi(111, 158)).toBeCloseTo(44.46, 2);
    expect(bmi(72.5, 170)).toBeCloseTo(25.09, 2);
  });

  it('não divide por zero nem inventa valor sem dado', () => {
    expect(bmi(80, 0)).toBeNull();
    expect(bmi(80, null)).toBeNull();
    expect(bmi(null, 170)).toBeNull();
  });

  it('rotula sexo em PT-BR e não chuta quando é nulo', () => {
    expect(sexLabel('M')).toBe('Masculino');
    expect(sexLabel('F')).toBe('Feminino');
    expect(sexLabel(null)).toBe(EMPTY_VALUE);
  });
});
