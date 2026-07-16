-- CreateIndex
CREATE INDEX "complaints_user_id_deleted_at_created_at_idx" ON "complaints"("user_id", "deleted_at", "created_at");
