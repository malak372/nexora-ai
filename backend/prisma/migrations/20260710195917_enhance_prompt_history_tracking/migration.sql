-- AlterTable
ALTER TABLE "prompt_histories" ADD COLUMN     "guest_session_id" TEXT,
ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "ai_models_is_active_health_status_priority_idx" ON "ai_models"("is_active", "health_status", "priority");

-- CreateIndex
CREATE INDEX "prompt_histories_user_id_idx" ON "prompt_histories"("user_id");

-- CreateIndex
CREATE INDEX "prompt_histories_guest_session_id_idx" ON "prompt_histories"("guest_session_id");

-- AddForeignKey
ALTER TABLE "prompt_histories" ADD CONSTRAINT "prompt_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_histories" ADD CONSTRAINT "prompt_histories_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
