-- CreateEnum
CREATE TYPE "PublicationReportReason" AS ENUM ('SPAM', 'OFFENSIVE', 'MISLEADING', 'COPYRIGHT', 'PRIVACY', 'OTHER');

-- CreateEnum
CREATE TYPE "ModerationReportStatus" AS ENUM ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_REPORT_PUBLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_HIDE_PUBLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_RESTORE_PUBLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_ARCHIVE_PUBLICATION';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_REVIEW_PUBLICATION_REPORT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditTargetType" ADD VALUE 'IDEA_PUBLICATION_FEEDBACK';
ALTER TYPE "AuditTargetType" ADD VALUE 'IDEA_PUBLICATION_REPORT';

-- AlterTable
ALTER TABLE "idea_publications" ADD COLUMN     "hidden_at" TIMESTAMP(3),
ADD COLUMN     "hidden_reason" TEXT,
ADD COLUMN     "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "idea_publication_reports" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reason" "PublicationReportReason" NOT NULL,
    "details" TEXT,
    "status" "ModerationReportStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "admin_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_publication_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idea_publication_reports_publication_id_status_idx" ON "idea_publication_reports"("publication_id", "status");

-- CreateIndex
CREATE INDEX "idea_publication_reports_reporter_id_created_at_idx" ON "idea_publication_reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "idea_publication_reports_status_created_at_idx" ON "idea_publication_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_reports_publication_id_reporter_id_key" ON "idea_publication_reports"("publication_id", "reporter_id");

-- CreateIndex
CREATE INDEX "idea_publications_is_hidden_status_published_at_idx" ON "idea_publications"("is_hidden", "status", "published_at");

-- AddForeignKey
ALTER TABLE "idea_publication_reports" ADD CONSTRAINT "idea_publication_reports_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_reports" ADD CONSTRAINT "idea_publication_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_reports" ADD CONSTRAINT "idea_publication_reports_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
