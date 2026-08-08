/**
 * Golden test do motor clínico TS — roda TODOS os casos de `golden-dataset.ts`
 * contra `evaluateVitalSigns` e trava o comportamento atual.
 *
 * A paridade com a implementação SQL (`eval_clinical_status`) é verificada à
 * parte por `supabase/_scripts/testes/paridade_clinica.mjs`, que consome ESTE
 * MESMO dataset — se você mudar um caso aqui, a paridade cobra o outro lado.
 */
import { describe, expect, it } from 'vitest';
import { evaluateVitalSigns } from './status.js';
import { CASOS_OURO, type CasoOuro } from './golden-dataset.js';

function rodar(c: CasoOuro) {
  return evaluateVitalSigns(
    {
      temperature: c.temperatura,
      spo2: c.spo2,
      systolic: c.sistolica,
      diastolic: c.diastolica,
      heartRate: c.fc,
      pain: c.dor,
      dyspnea: c.dispneia,
      urinatedNormally: c.urinouNormal,
      urinationCount: c.miccoes,
      hadVomit: c.vomito,
      hadBleeding: c.sangramento,
      stepsCount: c.passos,
      waterIntakeOk: c.aguaOk,
    },
    { previousDaySteps: c.passosRef, previousPain: c.dorAnterior },
  );
}

describe('dataset clínico de referência (golden) — motor TS', () => {
  it.each(CASOS_OURO.map((c) => [c.nome, c] as const))('%s', (_nome, c) => {
    expect(rodar(c).overall).toBe(c.esperado);
  });

  it('nenhum caso do dataset está duplicado por nome', () => {
    const nomes = CASOS_OURO.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it('o dataset cobre as três cores (não degenera para uma só)', () => {
    const cores = new Set(CASOS_OURO.map((c) => c.esperado));
    expect(cores).toEqual(new Set(['GREEN', 'YELLOW', 'RED']));
  });
});
