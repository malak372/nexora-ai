/*
  Warnings:

  - The values [CLAUDE,GEMINI] on the enum `AiProviderType` will be removed. If these variants are still used in the database, this will fail.
  - The values [DATA_COLLECTION_RUN,DATA_COLLECTION_STOP] on the enum `AuditAction` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[idea_id,output_type]` on the table `generated_outputs` will be added. If there are existing duplicate values, this will fail.

*/
-- Rename removed AuditAction values safely.
BEGIN;

CREATE TYPE "AuditAction_new" AS ENUM (
  'ADMIN_UPDATE_USER_STATUS',
  'ADMIN_SOFT_DELETE_USER',
  'ADMIN_ADJUST_USER_CREDITS',
  'ADMIN_SEND_PASSWORD_RESET_EMAIL',
  'ADMIN_UPDATE_SETTINGS',
  'ADMIN_UPDATE_PROMPT',
  'ADMIN_CREATE_ALERT',
  'ADMIN_CREATE_PLATFORM',
  'ADMIN_UPDATE_PLATFORM',
  'ADMIN_DEACTIVATE_PLATFORM',
  'ADMIN_CREATE_DOMAIN',
  'ADMIN_UPDATE_DOMAIN',
  'ADMIN_DEACTIVATE_DOMAIN',
  'ADMIN_UPDATE_COMPLAINT',
  'ADMIN_UPDATE_CONTACT_MESSAGE',
  'ADMIN_CREATE_AI_MODEL',
  'ADMIN_UPDATE_AI_MODEL',
  'ADMIN_DEACTIVATE_AI_MODEL',
  'ADMIN_SET_DEFAULT_AI_MODEL',
  'RUN_DATA_COLLECTION',
  'COMPLETE_DATA_COLLECTION',
  'FAIL_DATA_COLLECTION',
  'STOP_DATA_COLLECTION',
  'ADMIN_START_DATA_COLLECTION',
  'ADMIN_STOP_DATA_COLLECTION',
  'USER_GENERATE_IDEA',
  'USER_UNLOCK_IDEA',
  'USER_CREATE_COMPLAINT',
  'USER_CREATE_CONTACT_MESSAGE',
  'USER_AI_CHAT',
  'USER_UPDATE_PROFILE',
  'USER_MARK_NOTIFICATION_READ',
  'USER_MARK_ALL_NOTIFICATIONS_READ',
  'NLP_ANALYSIS_RUN',
  'ABSTRACT_GENERATION_RUN',
  'PROMPT_HISTORY_CREATED'
);

ALTER TABLE "public"."audit_logs"
ALTER COLUMN "action" TYPE "AuditAction_new"
USING (
  CASE "action"::text
    WHEN 'DATA_COLLECTION_RUN' THEN 'RUN_DATA_COLLECTION'
    WHEN 'DATA_COLLECTION_STOP' THEN 'STOP_DATA_COLLECTION'
    ELSE "action"::text
  END
)::"AuditAction_new";

ALTER TYPE "public"."AuditAction"
RENAME TO "AuditAction_old";

ALTER TYPE "public"."AuditAction_new"
RENAME TO "AuditAction";

DROP TYPE "public"."AuditAction_old";

COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApiProvider" ADD VALUE 'ANTHROPIC';
ALTER TYPE "ApiProvider" ADD VALUE 'GOOGLE';
ALTER TYPE "ApiProvider" ADD VALUE 'FORUM';
ALTER TYPE "ApiProvider" ADD VALUE 'BLOG';
ALTER TYPE "ApiProvider" ADD VALUE 'NEWS';
ALTER TYPE "ApiProvider" ADD VALUE 'HACKER_NEWS';
ALTER TYPE "ApiProvider" ADD VALUE 'PRODUCT_HUNT';
ALTER TYPE "ApiProvider" ADD VALUE 'DEV_TO';

-- Rename AI provider enum values safely.
BEGIN;

CREATE TYPE "AiProviderType_new" AS ENUM (
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE'
);

ALTER TABLE "public"."ai_models"
ALTER COLUMN "provider" DROP DEFAULT;

ALTER TABLE "public"."ai_models"
ALTER COLUMN "provider" TYPE "AiProviderType_new"
USING (
  CASE "provider"::text
    WHEN 'CLAUDE' THEN 'ANTHROPIC'
    WHEN 'GEMINI' THEN 'GOOGLE'
    ELSE "provider"::text
  END
)::"AiProviderType_new";

ALTER TYPE "public"."AiProviderType"
RENAME TO "AiProviderType_old";

ALTER TYPE "public"."AiProviderType_new"
RENAME TO "AiProviderType";

DROP TYPE "public"."AiProviderType_old";

ALTER TABLE "public"."ai_models"
ALTER COLUMN "provider" SET DEFAULT 'OPENAI';

COMMIT;

-- DropIndex
DROP INDEX "public"."ai_models_is_default_idx";

-- DropIndex
DROP INDEX "public"."external_api_logs_created_at_idx";

-- DropIndex
DROP INDEX "public"."external_api_logs_is_success_idx";

-- DropIndex
DROP INDEX "public"."external_api_logs_provider_idx";

-- DropIndex
DROP INDEX "public"."external_api_logs_request_type_idx";

-- DropIndex
DROP INDEX "public"."nlp_lexicons_type_idx";

-- CreateIndex
CREATE INDEX "alerts_user_id_is_read_idx" ON "alerts"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages"("session_id");

-- CreateIndex
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages"("created_at");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_idx" ON "chat_sessions"("user_id");

-- CreateIndex
CREATE INDEX "chat_sessions_idea_id_idx" ON "chat_sessions"("idea_id");

-- CreateIndex
CREATE INDEX "chat_sessions_created_at_idx" ON "chat_sessions"("created_at");

-- CreateIndex
CREATE INDEX "complaints_user_id_idx" ON "complaints"("user_id");

-- CreateIndex
CREATE INDEX "complaints_idea_id_idx" ON "complaints"("idea_id");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "complaints_priority_idx" ON "complaints"("priority");

-- CreateIndex
CREATE INDEX "complaints_created_at_idx" ON "complaints"("created_at");

-- CreateIndex
CREATE INDEX "credit_transactions_user_id_idx" ON "credit_transactions"("user_id");

-- CreateIndex
CREATE INDEX "credit_transactions_payment_id_idx" ON "credit_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "credit_transactions_idea_id_idx" ON "credit_transactions"("idea_id");

-- CreateIndex
CREATE INDEX "credit_transactions_type_idx" ON "credit_transactions"("type");

-- CreateIndex
CREATE INDEX "credit_transactions_created_at_idx" ON "credit_transactions"("created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_provider_created_at_idx" ON "external_api_logs"("provider", "created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_request_type_created_at_idx" ON "external_api_logs"("request_type", "created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_is_success_created_at_idx" ON "external_api_logs"("is_success", "created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_user_id_created_at_idx" ON "external_api_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_idea_id_created_at_idx" ON "external_api_logs"("idea_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "generated_outputs_idea_id_output_type_key" ON "generated_outputs"("idea_id", "output_type");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "payments_idea_id_idx" ON "payments"("idea_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_payment_purpose_idx" ON "payments"("payment_purpose");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");


ALTER TABLE "ai_models"
ADD CONSTRAINT "ai_models_default_must_be_active"
CHECK (NOT "is_default" OR "is_active");
