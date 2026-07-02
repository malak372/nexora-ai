-- CreateEnum
CREATE TYPE "AuthAction" AS ENUM ('REGISTER', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'REFRESH_TOKEN', 'CHANGE_PASSWORD', 'FORGOT_PASSWORD', 'RESET_PASSWORD', 'EMAIL_VERIFIED', 'RESEND_VERIFICATION_EMAIL', 'ACCOUNT_LOCKED');

-- CreateTable
CREATE TABLE "authentication_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" "AuthAction" NOT NULL,
    "email" TEXT,
    "is_success" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authentication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "authentication_logs_user_id_idx" ON "authentication_logs"("user_id");

-- CreateIndex
CREATE INDEX "authentication_logs_action_idx" ON "authentication_logs"("action");

-- CreateIndex
CREATE INDEX "authentication_logs_email_idx" ON "authentication_logs"("email");

-- CreateIndex
CREATE INDEX "authentication_logs_created_at_idx" ON "authentication_logs"("created_at");

-- AddForeignKey
ALTER TABLE "authentication_logs" ADD CONSTRAINT "authentication_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
