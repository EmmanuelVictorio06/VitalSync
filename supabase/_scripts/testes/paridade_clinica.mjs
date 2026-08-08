// ============================================================================
// Paridade TS ↔ SQL do motor clínico (Seção 1.2 do plano de testes).
//
// `thresholds.ts`/`status.ts` (TS) e `eval_clinical_status` (SQL, 0053) são
// duas implementações da MESMA regra. Este script roda o dataset golden
// (packages/shared/src/clinical/golden-dataset.ts) contra as duas e compara
// resultado a resultado. Divergência é defeito grave: o gráfico do médico
// mostraria uma cor e o alerta dispararia outra.
//
// Pré-requisitos: `npm run build:shared` e o stack local de pé
// (`supabase start`). Uso:  node supabase/_scripts/testes/paridade_clinica.mjs
// Sai com código 1 se houver qualquer divergência.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { CASOS_OURO } from '../../../packages/shared/dist/clinical/golden-dataset.js';
import { evaluateVitalSigns } from '../../../packages/shared/dist/clinical/status.js';

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_VitalSync';

function sqlLiteral(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

// Uma linha VALUES por caso, na ORDEM DOS ARGUMENTOS de eval_clinical_status
// (0053): temp, spo2, fc, dor, dispneia, urinou, miccoes, vomito, sangramento,
// passos, passos_ref, sistolica, diastolica, agua_ok, dor_anterior.
const values = CASOS_OURO.map((c, i) =>
  `(${i}, ${sqlLiteral(c.temperatura)}, ${sqlLiteral(c.spo2)}, ${sqlLiteral(c.fc)}, ${sqlLiteral(c.dor)}, ` +
  `${sqlLiteral(c.dispneia)}, ${sqlLiteral(c.urinouNormal)}, ${sqlLiteral(c.miccoes)}, ${sqlLiteral(c.vomito)}, ` +
  `${sqlLiteral(c.sangramento)}, ${sqlLiteral(c.passos)}, ${sqlLiteral(c.passosRef)}, ${sqlLiteral(c.sistolica)}, ` +
  `${sqlLiteral(c.diastolica)}, ${sqlLiteral(c.aguaOk)}, ${sqlLiteral(c.dorAnterior)})`,
).join(',\n');

const sql = `
select v.i, s.status::text
from (values
${values}
) as v(i, temp, spo2, fc, dor, disp, urinou, miccoes, vomito, sangue, passos, passos_ref, sist, diast, agua, dor_ant)
cross join lateral public.eval_clinical_status(
  v.temp::numeric, v.spo2::int, v.fc::int, v.dor::int, v.disp::int,
  v.urinou::boolean, v.miccoes::int, v.vomito::boolean, v.sangue::boolean,
  v.passos::int, v.passos_ref::int, v.sist::int, v.diast::int,
  v.agua::boolean, v.dor_ant::int
) s
order by v.i;
`;

const run = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-F', '|'], {
  input: sql,
  encoding: 'utf8',
});
if (run.status !== 0) {
  console.error('Falha ao executar o SQL no container:', run.stderr);
  process.exit(2);
}

const sqlResultados = new Map(
  run.stdout.trim().split('\n').filter(Boolean).map((linha) => {
    const [i, status] = linha.split('|');
    return [Number(i), status];
  }),
);

let divergencias = 0;
for (const [i, c] of CASOS_OURO.entries()) {
  const ts = evaluateVitalSigns(
    {
      temperature: c.temperatura, spo2: c.spo2, systolic: c.sistolica, diastolic: c.diastolica,
      heartRate: c.fc, pain: c.dor, dyspnea: c.dispneia, urinatedNormally: c.urinouNormal,
      urinationCount: c.miccoes, hadVomit: c.vomito, hadBleeding: c.sangramento,
      stepsCount: c.passos, waterIntakeOk: c.aguaOk,
    },
    { previousDaySteps: c.passosRef, previousPain: c.dorAnterior },
  ).overall;
  const sqlStatus = sqlResultados.get(i);

  if (ts !== c.esperado || sqlStatus !== c.esperado || ts !== sqlStatus) {
    divergencias++;
    console.log(`DIVERGÊNCIA  ${c.nome}`);
    console.log(`             esperado=${c.esperado}  TS=${ts}  SQL=${sqlStatus}`);
  }
}

console.log('');
console.log(`Casos: ${CASOS_OURO.length} · Divergências: ${divergencias}`);
console.log(divergencias === 0 ? 'PARIDADE OK — TS e SQL concordam em todos os casos.' : 'PARIDADE QUEBRADA — investigar antes de liberar.');
process.exit(divergencias === 0 ? 0 : 1);
