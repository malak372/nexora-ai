/*
  Warnings:

  - You are about to drop the `admin_audit_logs` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ADMIN_UPDATE_USER_STATUS', 'ADMIN_SOFT_DELETE_USER', 'ADMIN_UPDATE_SETTINGS', 'ADMIN_UPDATE_PROMPT', 'ADMIN_CREATE_ALERT', 'ADMIN_CREATE_PLATFORM', 'ADMIN_UPDATE_PLATFORM', 'ADMIN_DEACTIVATE_PLATFORM', 'ADMIN_CREATE_DOMAIN', 'ADMIN_UPDATE_DOMAIN', 'ADMIN_DEACTIVATE_DOMAIN', 'ADMIN_UPDATE_COMPLAINT', 'ADMIN_RUN_DATA_COLLECTION', 'ADMIN_STOP_DATA_COLLECTION', 'ADMIN_ADJUST_USER_CREDITS', 'ADMIN_SEND_PASSWORD_RESET_EMAIL', 'USER_GENERATE_IDEA', 'USER_UNLOCK_IDEA', 'USER_CREATE_COMPLAINT', 'DATA_COLLECTION_RUN', 'DATA_COLLECTION_STOP', 'NLP_ANALYSIS_RUN');

-- CreateEnum
CREATE TYPE "AuditTargetType" AS ENUM ('USER', 'IDEA', 'PAYMENT', 'DOMAIN', 'PLATFORM', 'SYSTEM_SETTING', 'PROMPT', 'COMPLAINT', 'ALERT', 'CREDIT_TRANSACTION', 'DATA_COLLECTION', 'NLP_ANALYSIS');

-- DropForeignKey
ALTER TABLE "public"."admin_audit_logs" DROP CONSTRAINT "admin_audit_logs_admin_id_fkey";

-- DropTable
DROP TABLE "public"."admin_audit_logs";

-- DropEnum
DROP TYPE "public"."AdminAction";

-- DropEnum
DROP TYPE "public"."AdminTargetType";

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "target_type" "AuditTargetType" NOT NULL,
    "target_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_idx" ON "audit_logs"("target_type");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
