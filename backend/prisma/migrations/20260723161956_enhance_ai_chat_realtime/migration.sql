/*
  Warnings:

  - Added the required column `updated_at` to the `chat_messages` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- DropIndex
DROP INDEX "public"."chat_messages_session_id_created_at_idx";

-- DropIndex
DROP INDEX "public"."chat_sessions_created_at_idx";

-- DropIndex
DROP INDEX "public"."chat_sessions_idea_id_idx";

-- DropIndex
DROP INDEX "public"."chat_sessions_user_id_idx";

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "status" "ChatMessageStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "chat_messages_session_id_deleted_at_created_at_idx" ON "chat_messages"("session_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_status_idx" ON "chat_messages"("session_id", "status");

-- CreateIndex
CREATE INDEX "chat_sessions_user_id_deleted_at_last_message_at_idx" ON "chat_sessions"("user_id", "deleted_at", "last_message_at");

-- CreateIndex
CREATE INDEX "chat_sessions_idea_id_deleted_at_idx" ON "chat_sessions"("idea_id", "deleted_at");
