-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IdeaGenerationRunStatus" ADD VALUE 'RETRYING';
ALTER TYPE "IdeaGenerationRunStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "idea_generation_runs" ADD COLUMN     "context_snapshot" JSONB,
ADD COLUMN     "next_retry_at" TIMESTAMP(3),
ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "retry_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "idea_generation_runs_status_next_retry_at_idx" ON "idea_generation_runs"("status", "next_retry_at");
