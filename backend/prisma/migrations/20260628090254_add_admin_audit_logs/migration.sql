-- CreateEnum
CREATE TYPE "AdminAction" AS ENUM ('ADMIN_UPDATE_USER_STATUS', 'ADMIN_SOFT_DELETE_USER', 'ADMIN_UPDATE_SETTINGS', 'ADMIN_UPDATE_PROMPT', 'ADMIN_CREATE_ALERT', 'ADMIN_CREATE_PLATFORM', 'ADMIN_UPDATE_PLATFORM', 'ADMIN_DEACTIVATE_PLATFORM', 'ADMIN_CREATE_DOMAIN', 'ADMIN_UPDATE_DOMAIN', 'ADMIN_DEACTIVATE_DOMAIN', 'ADMIN_UPDATE_COMPLAINT', 'ADMIN_RUN_DATA_COLLECTION', 'ADMIN_STOP_DATA_COLLECTION');

-- CreateEnum
CREATE TYPE "AdminTargetType" AS ENUM ('USER', 'IDEA', 'PAYMENT', 'DOMAIN', 'PLATFORM', 'SYSTEM_SETTING', 'PROMPT', 'COMPLAINT', 'ALERT');

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "action" "AdminAction" NOT NULL,
    "target_type" "AdminTargetType" NOT NULL,
    "target_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_id_idx" ON "admin_audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs"("action");

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_idx" ON "admin_audit_logs"("target_type");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
