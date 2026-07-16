-- AlterTable
ALTER TABLE "collection_jobs" ADD COLUMN     "created_by_id" TEXT;

-- CreateIndex
CREATE INDEX "collection_jobs_created_by_id_idx" ON "collection_jobs"("created_by_id");

-- AddForeignKey
ALTER TABLE "collection_jobs" ADD CONSTRAINT "collection_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
