-- CreateIndex
CREATE INDEX "contact_messages_user_id_deleted_at_created_at_idx" ON "contact_messages"("user_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "contact_messages_deleted_at_status_created_at_idx" ON "contact_messages"("deleted_at", "status", "created_at");
