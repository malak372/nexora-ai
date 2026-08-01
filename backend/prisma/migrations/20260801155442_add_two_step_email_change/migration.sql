-- CreateTable
CREATE TABLE "email_change_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "old_email" TEXT NOT NULL,
    "new_email" TEXT NOT NULL,
    "current_code_hash" TEXT NOT NULL,
    "current_code_expires_at" TIMESTAMP(3) NOT NULL,
    "current_attempts" INTEGER NOT NULL DEFAULT 0,
    "current_email_verified_at" TIMESTAMP(3),
    "new_code_hash" TEXT,
    "new_code_expires_at" TIMESTAMP(3),
    "new_attempts" INTEGER NOT NULL DEFAULT 0,
    "new_email_verified_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_change_requests_user_id_completed_at_cancelled_at_idx" ON "email_change_requests"("user_id", "completed_at", "cancelled_at");

-- CreateIndex
CREATE INDEX "email_change_requests_current_code_expires_at_idx" ON "email_change_requests"("current_code_expires_at");

-- CreateIndex
CREATE INDEX "email_change_requests_new_code_expires_at_idx" ON "email_change_requests"("new_code_expires_at");

-- AddForeignKey
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
