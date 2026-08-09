/**
 * Dataset clínico de referência (golden) — TRAVA o comportamento atual das
 * regras de status, valor a valor, nas bordas.
 *
 * Consumido por DOIS verificadores:
 *   1. `thresholds.golden.test.ts` (vitest) — roda contra o motor TS
 *      (`evaluateVitalSigns`).
 *   2. `supabase/_scripts/testes/paridade_clinica.mjs` — roda os MESMOS casos
 *      contra `eval_clinical_status` (SQL) e compara os três resultados
 *      (esperado × TS × SQL). Divergência TS↔SQL é defeito grave: o gráfico
 *      mostraria uma cor e o alerta dispararia outra.
 *
 * SITUAÇÃO DAS REGRAS SENSÍVEIS (docs/PONTOS_PENDENTES.md):
 *   • PAS ≥ 140 → RED: ✅ RESOLVIDA em 08/08/2026 — a equipe médica confirmou
 *     que a regra implementada desde a 0048 prevalece sobre o valor do
 *     protocolo (> 160). Os casos abaixo testam a regra OFICIAL.
 *   • SpO2 = 92 → RED: ⚠️ SEGUE PENDENTE. O protocolo é ambíguo exatamente em
 *     92 (aparece no amarelo "92–94" e no vermelho "≤92"); o código mantém
 *     RED, mais conservador. O dataset trava o atual — NÃO é uma correção.
 * Se uma decisão médica futura mudar qualquer regra, os casos aqui DEVEM
 * falhar — é esse o papel deles.
 */

export type StatusEsperado = 'GREEN' | 'YELLOW' | 'RED';

export interface CasoOuro {
  nome: string;
  temperatura: number;
  spo2: number;
  sistolica: number;
  diastolica: number;
  fc: number;
  dor: number;
  dispneia: number;
  urinouNormal: boolean;
  miccoes: number | null;
  vomito: boolean;
  sangramento: boolean;
  passos: number | null;
  passosRef: number | null;
  aguaOk: boolean;
  dorAnterior: number | null;
  esperado: StatusEsperado;
}

/** Medição base 100% verde — cada caso varia só a dimensão que nomeia. */
const BASE = {
  temperatura: 36.5,
  spo2: 98,
  sistolica: 120,
  diastolica: 80,
  fc: 80,
  dor: 0,
  dispneia: 0,
  urinouNormal: true,
  miccoes: 4 as number | null,
  vomito: false,
  sangramento: false,
  passos: null as number | null,
  passosRef: null as number | null,
  aguaOk: true,
  dorAnterior: null as number | null,
};

function caso(nome: string, esperado: StatusEsperado, delta: Partial<Omit<CasoOuro, 'nome' | 'esperado'>>): CasoOuro {
  return { nome, esperado, ...BASE, ...delta };
}

export const CASOS_OURO: CasoOuro[] = [
  // ---- controles verdes -----------------------------------------------------
  caso('base toda verde', 'GREEN', {}),
  caso('tudo no limite superior do verde', 'GREEN', {
    temperatura: 37.7, spo2: 95, sistolica: 129, diastolica: 89, fc: 110, dor: 6, miccoes: 4,
  }),

  // ---- temperatura: 37,7 / 37,8 / 38,4 / 38,5 ------------------------------
  caso('temp 37,7 verde', 'GREEN', { temperatura: 37.7 }),
  caso('temp 37,8 amarelo', 'YELLOW', { temperatura: 37.8 }),
  caso('temp 38,4 amarelo', 'YELLOW', { temperatura: 38.4 }),
  caso('temp 38,5 vermelho', 'RED', { temperatura: 38.5 }),

  // ---- SpO2: 95 / 94 / 93 / 92 / 91 (92→RED trava a pendência) --------------
  caso('spo2 95 verde', 'GREEN', { spo2: 95 }),
  caso('spo2 94 amarelo', 'YELLOW', { spo2: 94 }),
  caso('spo2 93 amarelo', 'YELLOW', { spo2: 93 }),
  caso('spo2 92 vermelho (pendência: protocolo ambíguo, código mantém RED)', 'RED', { spo2: 92 }),
  caso('spo2 91 vermelho', 'RED', { spo2: 91 }),

  // ---- PAS: bordas + a divergência 140×160 travada como está ----------------
  caso('PAS 89 vermelho (hipotensão)', 'RED', { sistolica: 89 }),
  caso('PAS 90 amarelo', 'YELLOW', { sistolica: 90 }),
  caso('PAS 99 amarelo', 'YELLOW', { sistolica: 99 }),
  caso('PAS 100 verde', 'GREEN', { sistolica: 100 }),
  caso('PAS 129 verde', 'GREEN', { sistolica: 129 }),
  caso('PAS 130 amarelo', 'YELLOW', { sistolica: 130 }),
  caso('PAS 139 amarelo', 'YELLOW', { sistolica: 139 }),
  caso('PAS 140 vermelho (decisão médica de 08/08/2026: ≥140 prevalece sobre o protocolo)', 'RED', { sistolica: 140 }),
  caso('PAS 160 vermelho', 'RED', { sistolica: 160 }),
  caso('PAS 161 vermelho', 'RED', { sistolica: 161 }),

  // ---- PAD ------------------------------------------------------------------
  caso('PAD 49 vermelho', 'RED', { diastolica: 49 }),
  caso('PAD 50 amarelo', 'YELLOW', { diastolica: 50 }),
  caso('PAD 60 verde', 'GREEN', { diastolica: 60 }),
  caso('PAD 89 verde', 'GREEN', { diastolica: 89 }),
  caso('PAD 90 amarelo', 'YELLOW', { diastolica: 90 }),
  caso('PAD 100 vermelho', 'RED', { diastolica: 100 }),

  // ---- FC: 110 / 111 / 119 / 120 -------------------------------------------
  caso('FC 110 verde', 'GREEN', { fc: 110 }),
  caso('FC 111 amarelo', 'YELLOW', { fc: 111 }),
  caso('FC 119 amarelo', 'YELLOW', { fc: 119 }),
  caso('FC 120 vermelho', 'RED', { fc: 120 }),

  // ---- dor: 6 / 7 / 8 / 9 ---------------------------------------------------
  caso('dor 6 verde', 'GREEN', { dor: 6 }),
  caso('dor 7 amarelo', 'YELLOW', { dor: 7 }),
  caso('dor 8 amarelo', 'YELLOW', { dor: 8 }),
  caso('dor 9 vermelho', 'RED', { dor: 9 }),

  // ---- dispneia -------------------------------------------------------------
  caso('dispneia 1 amarelo', 'YELLOW', { dispneia: 1 }),
  caso('dispneia 2 vermelho', 'RED', { dispneia: 2 }),

  // ---- diurese --------------------------------------------------------------
  caso('1 micção vermelho', 'RED', { miccoes: 1 }),
  caso('2 micções amarelo (sem gatilho combinado)', 'YELLOW', { miccoes: 2 }),
  caso('3 micções amarelo (sem gatilho combinado)', 'YELLOW', { miccoes: 3 }),
  caso('4 micções verde', 'GREEN', { miccoes: 4 }),
  caso('sem contagem, não urinou normalmente → amarelo', 'YELLOW', { miccoes: null, urinouNormal: false }),
  caso('sem contagem, urinou normalmente → verde', 'GREEN', { miccoes: null, urinouNormal: true }),

  // ---- binários -------------------------------------------------------------
  caso('vômito vermelho', 'RED', { vomito: true }),
  caso('sangramento vermelho', 'RED', { sangramento: true }),
  caso('não consegue ingerir líquidos → vermelho (0051)', 'RED', { aguaOk: false }),

  // ---- passos (queda ≥50% vs. referência ~48h = amarelo) --------------------
  caso('passos queda exata de 50% amarelo', 'YELLOW', { passos: 500, passosRef: 1000 }),
  caso('passos queda de 49,9% verde', 'GREEN', { passos: 501, passosRef: 1000 }),
  caso('passos sem referência → verde', 'GREEN', { passos: 400, passosRef: null }),

  // ---- critérios COMBINADOS (0051) — promovem a VERMELHO --------------------
  caso('combinado 1: queda ≥50% + FC>110', 'RED', { passos: 400, passosRef: 1000, fc: 111 }),
  caso('combinado 1: queda ≥50% + dor subiu 3 pontos (dor 5 sozinha é verde)', 'RED', {
    passos: 400, passosRef: 1000, fc: 100, dor: 5, dorAnterior: 2,
  }),
  caso('controle: queda ≥50% + dor subiu só 2 → amarelo isolado de passos', 'YELLOW', {
    passos: 400, passosRef: 1000, fc: 100, dor: 5, dorAnterior: 3,
  }),
  caso('combinado 2: 3 micções + FC=110 (FC 110 sozinha é verde)', 'RED', { miccoes: 3, fc: 110 }),
  caso('combinado 2: 2 micções + temp 38,0', 'RED', { miccoes: 2, temperatura: 38.0 }),
  caso('combinado 2: 3 micções + queda ≥50% de passos', 'RED', { miccoes: 3, passos: 400, passosRef: 1000 }),
  caso('controle: 3 micções + FC=109 → amarelo (sem combinado)', 'YELLOW', { miccoes: 3, fc: 109 }),

  // ---- amarelo múltiplo continua amarelo (não vira vermelho) ----------------
  caso('dois critérios amarelos (temp 38,0 + dor 7) seguem amarelo', 'YELLOW', { temperatura: 38.0, dor: 7 }),
];
