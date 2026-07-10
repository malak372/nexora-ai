-- DropIndex
DROP INDEX "public"."ideas_collection_job_id_key";

-- CreateIndex
CREATE INDEX "ideas_collection_job_id_idx" ON "ideas"("collection_job_id");
