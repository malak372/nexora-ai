/*
  Warnings:

  - A unique constraint covering the columns `[provider_payment_id]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[provider_session_id]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `provider` to the `payments` table without a default value. This is not possible if the table is not empty.

*/

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PAYPAL', 'PALPAY');

-- AlterTable
ALTER TABLE "payments"
ADD COLUMN "bonus_credits_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failed_at" TIMESTAMP(3),
ADD COLUMN "failure_reason" TEXT,
ADD COLUMN "paid_at" TIMESTAMP(3),
ADD COLUMN "provider" "PaymentProvider",
ADD COLUMN "provider_payment_id" TEXT,
ADD COLUMN "provider_session_id" TEXT,
ADD COLUMN "refunded_at" TIMESTAMP(3);

-- Backfill the provider value for existing payment records.
UPDATE "payments"
SET "provider" =
  CASE
    WHEN "payment_method" = 'CARD' THEN 'STRIPE'::"PaymentProvider"
    WHEN "payment_method" = 'PAYPAL' THEN 'PAYPAL'::"PaymentProvider"
    WHEN "payment_method" = 'PALPAY' THEN 'PALPAY'::"PaymentProvider"
    ELSE 'STRIPE'::"PaymentProvider"
  END
WHERE "provider" IS NULL;

-- Make provider required after existing rows have been updated.
ALTER TABLE "payments"
ALTER COLUMN "provider" SET NOT NULL;

-- AlterTable
ALTER TABLE "system_settings"
ADD COLUMN "direct_unlock_price" DECIMAL(10,2) NOT NULL DEFAULT 10;

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key"
ON "payments"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_session_id_key"
ON "payments"("provider_session_id");

-- CreateIndex
CREATE INDEX "payments_provider_idx"
ON "payments"("provider");