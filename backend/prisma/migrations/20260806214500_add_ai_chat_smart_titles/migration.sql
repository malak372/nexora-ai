ALTER TABLE "chat_sessions"
ADD COLUMN "title_manually_edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "title_generated_at" TIMESTAMP(3);