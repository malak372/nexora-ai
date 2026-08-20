CREATE TABLE "admin_chat_message_deletions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_chat_message_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_chat_message_deletions_message_id_user_id_key"
ON "admin_chat_message_deletions"("message_id", "user_id");

CREATE INDEX "admin_chat_message_deletions_user_id_idx"
ON "admin_chat_message_deletions"("user_id");

ALTER TABLE "admin_chat_message_deletions"
ADD CONSTRAINT "admin_chat_message_deletions_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "admin_chat_messages"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_chat_message_deletions"
ADD CONSTRAINT "admin_chat_message_deletions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;