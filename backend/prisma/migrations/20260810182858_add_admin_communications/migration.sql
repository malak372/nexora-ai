-- CreateEnum
CREATE TYPE "AdminCommunicationScope" AS ENUM ('SELECTED', 'BROADCAST');

-- CreateEnum
CREATE TYPE "AdminCommunicationStatus" AS ENUM ('PENDING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AdminCommunicationEmailStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "admin_communications" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "scope" "AdminCommunicationScope" NOT NULL,
    "send_in_app" BOOLEAN NOT NULL DEFAULT false,
    "send_email" BOOLEAN NOT NULL DEFAULT false,
    "alert_type" "AlertType",
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "status" "AdminCommunicationStatus" NOT NULL DEFAULT 'PENDING',
    "in_app_delivered_count" INTEGER NOT NULL DEFAULT 0,
    "email_sent_count" INTEGER NOT NULL DEFAULT 0,
    "email_failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_communication_recipients" (
    "id" TEXT NOT NULL,
    "communication_id" TEXT NOT NULL,
    "user_id" TEXT,
    "full_name_snapshot" TEXT,
    "email_snapshot" TEXT NOT NULL,
    "in_app_delivered" BOOLEAN NOT NULL DEFAULT false,
    "email_status" "AdminCommunicationEmailStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "email_error" TEXT,
    "email_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_communication_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_communications_actor_id_created_at_idx" ON "admin_communications"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_communications_scope_created_at_idx" ON "admin_communications"("scope", "created_at");

-- CreateIndex
CREATE INDEX "admin_communications_status_created_at_idx" ON "admin_communications"("status", "created_at");

-- CreateIndex
CREATE INDEX "admin_communications_send_in_app_send_email_created_at_idx" ON "admin_communications"("send_in_app", "send_email", "created_at");

-- CreateIndex
CREATE INDEX "admin_communication_recipients_communication_id_idx" ON "admin_communication_recipients"("communication_id");

-- CreateIndex
CREATE INDEX "admin_communication_recipients_user_id_idx" ON "admin_communication_recipients"("user_id");

-- CreateIndex
CREATE INDEX "admin_communication_recipients_email_status_idx" ON "admin_communication_recipients"("email_status");

-- CreateIndex
CREATE INDEX "admin_communication_recipients_communication_id_user_id_idx" ON "admin_communication_recipients"("communication_id", "user_id");

-- AddForeignKey
ALTER TABLE "admin_communications" ADD CONSTRAINT "admin_communications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_communication_recipients" ADD CONSTRAINT "admin_communication_recipients_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "admin_communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_communication_recipients" ADD CONSTRAINT "admin_communication_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
