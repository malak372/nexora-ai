-- CreateIndex
CREATE INDEX "ideas_domain_deleted_created_idx" ON "ideas"("domain_id", "deleted_at", "created_at");
