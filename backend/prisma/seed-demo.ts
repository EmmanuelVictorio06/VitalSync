/**
 * Seed de DEMONSTRAÇÃO — gera pacientes com vários dias de medições (manhã/noite)
 * para popular os gráficos do Acompanhamento Individual.
 *
 * Os status são calculados pelo MESMO motor clínico do app (`evaluateVitalSigns`),
 * garantindo coerência com os alertas. Cenários incluídos:
 *   • Recuperação tranquila        (maioria verde)
 *   • Pico de febre no 4º dia      (vermelho e normalização)
 *   • Queda de saturação no 6º dia (vermelho)
 *   • Dor/dispneia + sangramento   (amarelo/vermelho)
 *
 * Uso:  npm run db:seed:demo   (na raiz)
 * É idempotente: remove os pacientes existentes e recria o conjunto de demonstração.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  MONITORING_DAYS,
  Period,
  evaluateVitalSigns,
  startOfToday,
  type VitalSignInput,
} from '@vitalsync/shared';

loadDotenv({ path: resolve(process.cwd(), '.env') });
const prisma = new PrismaClient();

const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173';

// ---- RNG determinístico (mulberry32) para dados reproduzíveis ----
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const addDaysUTC = (d: Date, days: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));

type ScenarioId = 'calm' | 'fever' | 'desat' | 'pain_bleed';

interface DemoPatient {
  name: string;
  birthDate: string;
  phone: string;
  teamNumber: number;
  surgery: string;
  hospital: string;
  days: number;
  scenario: ScenarioId;
}

const DEMO_PATIENTS: DemoPatient[] = [
  { name: 'João Pereira', birthDate: '1968-04-12', phone: '41991112222', teamNumber: 1, surgery: 'Colecistectomia', hospital: 'Hospital Marcelino Champagnat', days: 10, scenario: 'calm' },
  { name: 'Ana Souza', birthDate: '1985-09-03', phone: '41992223333', teamNumber: 1, surgery: 'Apendicectomia', hospital: 'Hospital Universitário Cajuru', days: 10, scenario: 'fever' },
  { name: 'Carlos Lima', birthDate: '1959-12-21', phone: '41993334444', teamNumber: 2, surgery: 'Artroplastia de joelho', hospital: 'Hospital de Clínicas - UFPR', days: 6, scenario: 'desat' },
  { name: 'Beatriz Rocha', birthDate: '1991-06-17', phone: '41994445555', teamNumber: 2, surgery: 'Cesariana', hospital: 'Hospital Nossa Senhora das Graças', days: 7, scenario: 'pain_bleed' },
];

/** Gera a medição de um período, aplicando o cenário ao dia. */
function buildInput(
  scenario: ScenarioId,
  day: number,
  period: Period,
  rng: () => number,
): VitalSignInput {
  const isNight = period === Period.NIGHT;
  const r = (min: number, max: number) => min + rng() * (max - min);

  const input: VitalSignInput = {
    temperature: Math.round((36.4 + r(-0.2, 0.4)) * 10) / 10,
    spo2: Math.round(clamp(97 + r(-1, 2), 93, 100)),
    systolic: Math.round(106 + r(-2, 4)), // base verde (< 110,9)
    diastolic: Math.round(74 + r(-3, 6)),
    heartRate: Math.round(74 + r(-4, 12)),
    pain: clamp(Math.round(4 - day * 0.3 + r(-1, 1)), 0, 10), // dor decrescente
    dyspnea: 0,
    urinatedNormally: true,
    urinationCount: Math.round(4 + r(0, 2)),
    hadVomit: false,
    vomitCount: null,
    hadBleeding: false,
    stepsCount: isNight ? Math.round(600 + day * 230 + r(-120, 120)) : null,
  };

  switch (scenario) {
    case 'fever':
      if (day === 4) {
        input.temperature = isNight ? 38.9 : 38.7; // vermelho
        input.heartRate = 104;
        input.pain = 6;
      } else if (day === 5 && !isNight) {
        input.temperature = 38.1; // amarelo
      }
      break;
    case 'desat':
      if (day === 6 && isNight) {
        input.spo2 = 91; // vermelho
        input.heartRate = 98;
        input.dyspnea = 4; // amarelo
      } else if (day === 7 && !isNight) {
        input.spo2 = 93.5; // amarelo
      }
      break;
    case 'pain_bleed':
      if (day === 5 && isNight) input.hadBleeding = true; // vermelho
      if (day === 7) input.pain = 7; // amarelo
      if (day === 8) {
        input.pain = 9; // vermelho
        input.dyspnea = 6; // vermelho
        if (isNight) input.stepsCount = 300; // queda acentuada de passos
      }
      break;
    case 'calm':
    default:
      if (day === 6 && !isNight) input.urinationCount = 3; // um amarelo pontual
      break;
  }
  return input;
}

async function ensureTeam(number: number, surgeon: { name: string; email: string; whatsapp: string }, associates: Array<{ name: string; email: string; whatsapp: string }>) {
  const existing = await prisma.medicalTeam.findUnique({ where: { number } });
  if (existing) return existing;

  const hash = await bcrypt.hash('senha123', 10);
  const team = await prisma.medicalTeam.create({ data: { number } });
  const surg = await prisma.user.create({
    data: { name: surgeon.name, email: surgeon.email, passwordHash: hash, whatsapp: surgeon.whatsapp, role: 'SURGEON', teamId: team.id },
  });
  await prisma.medicalTeam.update({ where: { id: team.id }, data: { surgeonId: surg.id } });
  for (const a of associates) {
    await prisma.user.create({
      data: { name: a.name, email: a.email, passwordHash: hash, whatsapp: a.whatsapp, role: 'ASSOCIATE', teamId: team.id },
    });
  }
  return team;
}

async function main(): Promise<void> {
  // Catálogos (do seed base)
  const surgeryTypes = await prisma.surgeryType.findMany();
  const hospitals = await prisma.hospital.findMany();
  if (surgeryTypes.length === 0 || hospitals.length === 0) {
    throw new Error('Rode "npm run db:seed" antes (faltam tipos de cirurgia/hospitais).');
  }
  const surgeryByName = new Map(surgeryTypes.map((s) => [s.name, s.id]));
  const hospitalByName = new Map(hospitals.map((h) => [h.name, h.id]));

  // Equipes
  await ensureTeam(1, { name: 'Dra. Drica', email: 'drica@hosp.com', whatsapp: '41999990000' }, [
    { name: 'Dr. Tico', email: 'tico@hosp.com', whatsapp: '41988887777' },
  ]);
  await ensureTeam(2, { name: 'Dr. House', email: 'house@hosp.com', whatsapp: '41999991111' }, [
    { name: 'Dra. Cuddy', email: 'cuddy@hosp.com', whatsapp: '41988886666' },
    { name: 'Dr. Wilson', email: 'wilson@hosp.com', whatsapp: '41977775555' },
  ]);
  const teams = new Map((await prisma.medicalTeam.findMany()).map((t) => [t.number, t.id]));

  // Limpa pacientes anteriores (idempotência) — cascata remove links/medições/alertas.
  await prisma.patient.updateMany({ data: { attendedById: null } });
  await prisma.patient.deleteMany({});

  const today = startOfToday();
  let seq = 1;
  const generatedLinks: Array<{ name: string; url: string }> = [];

  for (const dp of DEMO_PATIENTS) {
    const teamId = teams.get(dp.teamNumber)!;
    const dischargeDate = addDaysUTC(today, -(dp.days - 1)); // dia 1 .. hoje
    const surgeryDate = addDaysUTC(dischargeDate, -2);
    const rng = makeRng(seq * 7919);

    const patient = await prisma.patient.create({
      data: {
        name: dp.name,
        birthDate: new Date(`${dp.birthDate}T00:00:00.000Z`),
        phone: dp.phone,
        surgeryTypeId: surgeryByName.get(dp.surgery) ?? surgeryTypes[0]!.id,
        surgeryDate,
        dischargeDate,
        hospitalId: hospitalByName.get(dp.hospital) ?? hospitals[0]!.id,
        teamId,
      },
    });

    // Link seguro (token só na URL; banco guarda o hash).
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const expiresAt = addDaysUTC(dischargeDate, MONITORING_DAYS + 1);
    await prisma.patientMonitoringLink.create({ data: { patientId: patient.id, tokenHash, expiresAt } });
    generatedLinks.push({ name: dp.name, url: `${PUBLIC_WEB_URL}/r/${raw}` });

    // Medições dia a dia (manhã e noite).
    let prevNightSteps: number | null = null;
    let lastStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    let lastAt = today;

    for (let day = 1; day <= dp.days; day++) {
      const recordDate = addDaysUTC(dischargeDate, day - 1);
      for (const period of [Period.MORNING, Period.NIGHT]) {
        const input = buildInput(dp.scenario, day, period, rng);
        const evaluation = evaluateVitalSigns(input, {
          previousDaySteps: period === Period.NIGHT ? prevNightSteps : null,
        });
        const submittedAt = new Date(recordDate);
        submittedAt.setUTCHours(period === Period.MORNING ? 8 : 21, Math.floor(rng() * 50));

        await prisma.vitalSignRecord.create({
          data: {
            patientId: patient.id,
            recordDate,
            period,
            monitoringDay: day,
            temperature: input.temperature,
            spo2: input.spo2,
            systolic: input.systolic,
            diastolic: input.diastolic,
            heartRate: input.heartRate,
            pain: input.pain,
            dyspnea: input.dyspnea,
            urinatedNormally: input.urinatedNormally,
            urinationCount: input.urinationCount ?? null,
            hadVomit: input.hadVomit,
            vomitCount: input.vomitCount ?? null,
            hadBleeding: input.hadBleeding,
            stepsCount: period === Period.NIGHT ? input.stepsCount ?? null : null,
            overallStatus: evaluation.overall,
            statusByVital: evaluation.byVital,
          },
        });

        if (period === Period.NIGHT) prevNightSteps = input.stepsCount ?? prevNightSteps;
        lastStatus = evaluation.overall;
        lastAt = submittedAt;
      }
    }

    await prisma.patient.update({
      where: { id: patient.id },
      data: { currentStatus: lastStatus, lastMeasurementAt: lastAt },
    });

    console.info(`✔ ${dp.name} — ${dp.days} dias · status atual ${lastStatus}`);
    seq++;
  }

  console.info('\nLinks de acesso do paciente (abra no navegador / envie por WhatsApp):');
  for (const l of generatedLinks) console.info(`  • ${l.name}: ${l.url}`);
  console.info('\nSeed de demonstração concluído.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
