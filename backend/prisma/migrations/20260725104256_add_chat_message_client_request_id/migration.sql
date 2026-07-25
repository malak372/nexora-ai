/*
  Warnings:

  - A unique constraint covering the columns `[session_id,client_request_id]` on the table `chat_messages` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "client_request_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_session_id_client_request_id_key" ON "chat_messages"("session_id", "client_request_id");
