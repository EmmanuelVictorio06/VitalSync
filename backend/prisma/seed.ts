import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

// Carrega o .env da raiz do monorepo.
loadDotenv({ path: resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

const SURGERY_TYPES = [
  'Apendicectomia',
  'Colecistectomia',
  'Herniorrafia inguinal',
  'Cesariana',
  'Artroplastia de quadril',
  'Artroplastia de joelho',
  'Tireoidectomia',
  'Mastectomia',
  'Histerectomia',
  'Bypass gástrico',
  'Prostatectomia',
  'Cirurgia cardíaca (revascularização)',
];

const HOSPITALS = [
  'Hospital Universitário Cajuru',
  'Hospital Marcelino Champagnat',
  'Hospital Santa Casa de Curitiba',
  'Hospital de Clínicas - UFPR',
  'Hospital Nossa Senhora das Graças',
];

async function main(): Promise<void> {
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@vitalsync.local').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@123';
  const adminName = process.env.ADMIN_NAME ?? 'Administrador';

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    // Mantém a senha do ADM sincronizada com ADMIN_PASSWORD a cada seed.
    update: { passwordHash, name: adminName, role: 'ADM' },
    create: { name: adminName, email: adminEmail, passwordHash, role: 'ADM' },
  });
  console.info(`✔ ADM garantido (senha sincronizada): ${adminEmail}`);

  for (const name of SURGERY_TYPES) {
    await prisma.surgeryType.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.info(`✔ ${SURGERY_TYPES.length} tipos de cirurgia`);

  for (const name of HOSPITALS) {
    await prisma.hospital.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.info(`✔ ${HOSPITALS.length} hospitais`);

  console.info('Seed concluído.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
