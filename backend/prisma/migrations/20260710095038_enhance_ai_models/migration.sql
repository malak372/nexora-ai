/*
  Warnings:

  - A unique constraint covering the columns `[provider,api_model_id]` on the table `ai_models` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."ai_models_api_model_id_key";

-- DropIndex
DROP INDEX "public"."ai_models_is_active_idx";

-- DropIndex
DROP INDEX "public"."ai_models_provider_idx";

-- AlterTable
ALTER TABLE "external_api_logs" ADD COLUMN     "ai_model_id" TEXT,
ADD COLUMN     "api_model_id" TEXT,
ADD COLUMN     "input_tokens" INTEGER,
ADD COLUMN     "output_tokens" INTEGER;

-- CreateIndex
CREATE INDEX "ai_models_provider_is_active_idx" ON "ai_models"("provider", "is_active");

-- CreateIndex
CREATE INDEX "ai_models_created_at_idx" ON "ai_models"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_provider_api_model_id_key" ON "ai_models"("provider", "api_model_id");

-- CreateIndex
CREATE INDEX "external_api_logs_ai_model_id_idx" ON "external_api_logs"("ai_model_id");

-- CreateIndex
CREATE INDEX "external_api_logs_provider_idx" ON "external_api_logs"("provider");

-- CreateIndex
CREATE INDEX "external_api_logs_request_type_idx" ON "external_api_logs"("request_type");

-- CreateIndex
CREATE INDEX "external_api_logs_is_success_idx" ON "external_api_logs"("is_success");

-- CreateIndex
CREATE INDEX "external_api_logs_created_at_idx" ON "external_api_logs"("created_at");

-- AddForeignKey
ALTER TABLE "external_api_logs" ADD CONSTRAINT "external_api_logs_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_models_single_default_idx"
ON "ai_models" ("is_default")
WHERE "is_default" = true;
