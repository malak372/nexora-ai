-- Repair publication-report moderation columns when the Prisma schema is ahead of the database.
ALTER TABLE "idea_publication_reports"
    ADD COLUMN IF NOT EXISTS "moderation_action" TEXT,
    ADD COLUMN IF NOT EXISTS "publisher_message" TEXT,
    ADD COLUMN IF NOT EXISTS "publisher_notified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "reporter_message" TEXT,
    ADD COLUMN IF NOT EXISTS "reporter_notified" BOOLEAN NOT NULL DEFAULT false;