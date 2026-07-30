-- CreateEnum
CREATE TYPE "PublicationAdvancedUnlockMethod" AS ENUM ('NONE', 'DIRECT_PAYMENT', 'PREMIUM_CREDIT');

-- CreateEnum
CREATE TYPE "DomainResolutionSource" AS ENUM ('USER_SELECTED', 'USER_PREFERENCE', 'KEYWORD_MATCH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_ACCEPT_PUBLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'USER_UNLOCK_PUBLICATION_ADVANCED';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'IDEA_PUBLICATION_ACCEPTANCE';

-- AlterEnum
ALTER TYPE "CreditTransactionType" ADD VALUE 'DEDUCTION_PUBLICATION_ADVANCED';

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'ACCEPT_PUBLICATION';

-- AlterTable
ALTER TABLE "collection_jobs" ADD COLUMN     "domain_resolution_confidence" DECIMAL(4,3),
ADD COLUMN     "domain_resolution_source" "DomainResolutionSource" NOT NULL DEFAULT 'USER_SELECTED',
ADD COLUMN     "user_description" TEXT;

-- AlterTable
ALTER TABLE "credit_transactions" ADD COLUMN     "publication_acceptance_id" TEXT;

-- AlterTable
ALTER TABLE "nlp_analyses" ADD COLUMN     "ai_model_id" TEXT,
ADD COLUMN     "quality_warnings" JSONB;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "acceptance_city" TEXT,
ADD COLUMN     "acceptance_country" TEXT,
ADD COLUMN     "acceptance_region" TEXT,
ADD COLUMN     "activates_premium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "premium_activation_fee_at_purchase" DECIMAL(10,2),
ADD COLUMN     "publication_id" TEXT;

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "premium_activation_fee" DECIMAL(10,2) NOT NULL DEFAULT 5,
ADD COLUMN     "publication_advanced_credit_cost" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "published_idea_price" DECIMAL(10,2) NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "premium_activated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "business_model_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sections" JSONB NOT NULL,
    "prompt_guidance" JSONB,
    "supported_user_types" JSONB,
    "supported_domains" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_model_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_publication_acceptances" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "country" TEXT,
    "city" TEXT,
    "region" TEXT,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "advanced_unlocked_at" TIMESTAMP(3),
    "advanced_unlock_method" "PublicationAdvancedUnlockMethod" NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_publication_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_model_templates_key_key" ON "business_model_templates"("key");

-- CreateIndex
CREATE INDEX "business_model_templates_is_active_is_default_idx" ON "business_model_templates"("is_active", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_acceptances_payment_id_key" ON "idea_publication_acceptances"("payment_id");

-- CreateIndex
CREATE INDEX "idea_publication_acceptances_publication_id_accepted_at_idx" ON "idea_publication_acceptances"("publication_id", "accepted_at");

-- CreateIndex
CREATE INDEX "idea_publication_acceptances_user_id_accepted_at_idx" ON "idea_publication_acceptances"("user_id", "accepted_at");

-- CreateIndex
CREATE INDEX "idea_publication_acceptances_country_city_region_idx" ON "idea_publication_acceptances"("country", "city", "region");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_acceptances_publication_id_user_id_key" ON "idea_publication_acceptances"("publication_id", "user_id");

-- CreateIndex
CREATE INDEX "credit_transactions_publication_acceptance_id_idx" ON "credit_transactions"("publication_acceptance_id");

-- CreateIndex
CREATE INDEX "payments_publication_id_idx" ON "payments"("publication_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_publication_acceptance_id_fkey" FOREIGN KEY ("publication_acceptance_id") REFERENCES "idea_publication_acceptances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_acceptances" ADD CONSTRAINT "idea_publication_acceptances_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_acceptances" ADD CONSTRAINT "idea_publication_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_acceptances" ADD CONSTRAINT "idea_publication_acceptances_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
