-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADM', 'SURGEON', 'ASSOCIATE');

-- CreateEnum
CREATE TYPE "Period" AS ENUM ('MORNING', 'NIGHT');

-- CreateEnum
CREATE TYPE "ClinicalStatus" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "whatsapp" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_teams" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "surgeonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surgery_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "surgery_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "phone" TEXT NOT NULL,
    "surgeryTypeId" TEXT NOT NULL,
    "surgeryDate" DATE NOT NULL,
    "dischargeDate" DATE NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "currentStatus" "ClinicalStatus" NOT NULL DEFAULT 'GREEN',
    "lastMeasurementAt" TIMESTAMP(3),
    "attendedById" TEXT,
    "attendedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_monitoring_links" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "patient_monitoring_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vital_sign_records" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "period" "Period" NOT NULL,
    "monitoringDay" INTEGER NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "spo2" DOUBLE PRECISION NOT NULL,
    "systolic" INTEGER NOT NULL,
    "diastolic" INTEGER NOT NULL,
    "heartRate" INTEGER NOT NULL,
    "pain" INTEGER NOT NULL,
    "dyspnea" INTEGER NOT NULL,
    "urinatedNormally" BOOLEAN NOT NULL,
    "urinationCount" INTEGER,
    "hadVomit" BOOLEAN NOT NULL,
    "vomitCount" INTEGER,
    "hadBleeding" BOOLEAN NOT NULL,
    "stepsCount" INTEGER,
    "overallStatus" "ClinicalStatus" NOT NULL,
    "statusByVital" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_sign_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_alerts" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "vitalSignRecordId" TEXT NOT NULL,
    "status" "ClinicalStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_recipients" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL,
    "detail" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_confirmations" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "attendedByUserId" TEXT NOT NULL,
    "attendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_teamId_idx" ON "users"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "medical_teams_number_key" ON "medical_teams"("number");

-- CreateIndex
CREATE UNIQUE INDEX "medical_teams_surgeonId_key" ON "medical_teams"("surgeonId");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_types_name_key" ON "surgery_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_name_key" ON "hospitals"("name");

-- CreateIndex
CREATE INDEX "patients_teamId_idx" ON "patients"("teamId");

-- CreateIndex
CREATE INDEX "patients_currentStatus_idx" ON "patients"("currentStatus");

-- CreateIndex
CREATE INDEX "patients_isActive_idx" ON "patients"("isActive");

-- CreateIndex
CREATE INDEX "patients_name_idx" ON "patients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "patient_monitoring_links_tokenHash_key" ON "patient_monitoring_links"("tokenHash");

-- CreateIndex
CREATE INDEX "patient_monitoring_links_patientId_idx" ON "patient_monitoring_links"("patientId");

-- CreateIndex
CREATE INDEX "vital_sign_records_patientId_recordDate_idx" ON "vital_sign_records"("patientId", "recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "vital_sign_records_patientId_recordDate_period_key" ON "vital_sign_records"("patientId", "recordDate", "period");

-- CreateIndex
CREATE INDEX "clinical_alerts_patientId_idx" ON "clinical_alerts"("patientId");

-- CreateIndex
CREATE INDEX "clinical_alerts_status_idx" ON "clinical_alerts"("status");

-- CreateIndex
CREATE INDEX "alert_recipients_alertId_idx" ON "alert_recipients"("alertId");

-- CreateIndex
CREATE INDEX "attendance_confirmations_patientId_idx" ON "attendance_confirmations"("patientId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "medical_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_teams" ADD CONSTRAINT "medical_teams_surgeonId_fkey" FOREIGN KEY ("surgeonId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_surgeryTypeId_fkey" FOREIGN KEY ("surgeryTypeId") REFERENCES "surgery_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "medical_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_attendedById_fkey" FOREIGN KEY ("attendedById") REFERENCES "attendance_confirmations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_monitoring_links" ADD CONSTRAINT "patient_monitoring_links_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_records" ADD CONSTRAINT "vital_sign_records_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_alerts" ADD CONSTRAINT "clinical_alerts_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_alerts" ADD CONSTRAINT "clinical_alerts_vitalSignRecordId_fkey" FOREIGN KEY ("vitalSignRecordId") REFERENCES "vital_sign_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_recipients" ADD CONSTRAINT "alert_recipients_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "clinical_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_recipients" ADD CONSTRAINT "alert_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_confirmations" ADD CONSTRAINT "attendance_confirmations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_confirmations" ADD CONSTRAINT "attendance_confirmations_attendedByUserId_fkey" FOREIGN KEY ("attendedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
