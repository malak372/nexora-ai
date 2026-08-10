-- AlterTable
ALTER TABLE "idea_publication_reports" ADD COLUMN     "moderation_action" TEXT,
ADD COLUMN     "publisher_message" TEXT,
ADD COLUMN     "publisher_notified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reporter_message" TEXT,
ADD COLUMN     "reporter_notified" BOOLEAN NOT NULL DEFAULT false;
