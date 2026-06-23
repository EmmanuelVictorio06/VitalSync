-- AlterTable: foto da ferida operatória / dreno (campos opcionais)
ALTER TABLE "vital_sign_records"
  ADD COLUMN "woundPhotoUrl" TEXT,
  ADD COLUMN "woundPhotoStoragePath" TEXT,
  ADD COLUMN "woundPhotoFileName" TEXT,
  ADD COLUMN "woundPhotoMimeType" TEXT,
  ADD COLUMN "woundPhotoSize" INTEGER,
  ADD COLUMN "woundPhotoUploadedAt" TIMESTAMP(3);
