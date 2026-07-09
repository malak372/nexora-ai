-- CreateEnum
CREATE TYPE "AiProviderType" AS ENUM ('OPENAI', 'CLAUDE', 'GEMINI');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_CREATE_AI_MODEL';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_UPDATE_AI_MODEL';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_DEACTIVATE_AI_MODEL';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SET_DEFAULT_AI_MODEL';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'AI_MODEL';

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "provider" "AiProviderType" NOT NULL DEFAULT 'OPENAI',
    "model_name" TEXT NOT NULL,
    "api_model_id" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_models_provider_idx" ON "ai_models"("provider");

-- CreateIndex
CREATE INDEX "ai_models_is_active_idx" ON "ai_models"("is_active");

-- CreateIndex
CREATE INDEX "ai_models_is_default_idx" ON "ai_models"("is_default");

-- CreateIndex
CREATE INDEX "ai_models_priority_idx" ON "ai_models"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_provider_model_name_key" ON "ai_models"("provider", "model_name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_api_model_id_key" ON "ai_models"("api_model_id");
