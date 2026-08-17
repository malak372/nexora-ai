-- CreateEnum
CREATE TYPE "AdminConversationType" AS ENUM ('DIRECT', 'GROUP');

-- CreateTable
CREATE TABLE "admin_conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "type" "AdminConversationType" NOT NULL DEFAULT 'DIRECT',
    "direct_key" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3),

    CONSTRAINT "admin_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_conversation_members" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "admin_conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "admin_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_conversations_direct_key_key" ON "admin_conversations"("direct_key");

-- CreateIndex
CREATE INDEX "admin_conversations_last_message_at_idx" ON "admin_conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "admin_conversations_created_by_id_idx" ON "admin_conversations"("created_by_id");

-- CreateIndex
CREATE INDEX "admin_conversation_members_user_id_idx" ON "admin_conversation_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_conversation_members_conversation_id_user_id_key" ON "admin_conversation_members"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "admin_chat_messages_conversation_id_created_at_idx" ON "admin_chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_chat_messages_sender_id_idx" ON "admin_chat_messages"("sender_id");

-- AddForeignKey
ALTER TABLE "admin_conversations" ADD CONSTRAINT "admin_conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_conversation_members" ADD CONSTRAINT "admin_conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "admin_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_conversation_members" ADD CONSTRAINT "admin_conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_chat_messages" ADD CONSTRAINT "admin_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "admin_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_chat_messages" ADD CONSTRAINT "admin_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
