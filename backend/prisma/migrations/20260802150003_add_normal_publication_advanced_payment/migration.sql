/*
  Warnings:

  - A unique constraint covering the columns `[advanced_payment_id]` on the table `idea_publication_acceptances` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'UNLOCK_PUBLICATION_ADVANCED';

-- AlterTable
ALTER TABLE "idea_publication_acceptances" ADD COLUMN     "advanced_payment_id" TEXT;

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "normal_publication_advanced_price" DECIMAL(10,2) NOT NULL DEFAULT 5;

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_acceptances_advanced_payment_id_key" ON "idea_publication_acceptances"("advanced_payment_id");

-- AddForeignKey
ALTER TABLE "idea_publication_acceptances" ADD CONSTRAINT "idea_publication_acceptances_advanced_payment_id_fkey" FOREIGN KEY ("advanced_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
