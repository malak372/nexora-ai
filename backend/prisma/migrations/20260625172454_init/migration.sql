-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('NORMAL', 'PREMIUM');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'PAYPAL', 'PALPAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('BUY_CREDITS', 'DIRECT_UNLOCK');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('PURCHASE', 'BONUS', 'DEDUCTION_GENERATION', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "IdeaGenerationType" AS ENUM ('GUEST_FREE', 'NORMAL_FREE', 'PREMIUM_CREDIT');

-- CreateEnum
CREATE TYPE "UnlockMethod" AS ENUM ('NONE', 'DIRECT_PAYMENT', 'CREDIT_GENERATION');

-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('USER', 'AI');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplaintPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('SYSTEM', 'PAYMENT', 'CREDIT_LOW', 'CREDIT_EXHAUSTED', 'ADMIN');

-- CreateEnum
CREATE TYPE "ApiProvider" AS ENUM ('OPENAI', 'STRIPE', 'PAYPAL', 'PALPAY', 'REDDIT', 'FACEBOOK', 'GOOGLE_MAPS', 'OTHER');

-- CreateEnum
CREATE TYPE "ApiRequestType" AS ENUM ('DATA_COLLECTION', 'COMMENT_ANALYSIS', 'IDEA_GENERATION', 'AI_CHAT', 'PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "GeneratedOutputType" AS ENUM ('FULL_ABSTRACT', 'TECHNOLOGY_STACK', 'SYSTEM_ARCHITECTURE', 'DATABASE_DESIGN', 'COMMENT_ANALYSIS', 'SAMPLE_COMMENTS', 'NLP_ANALYSIS', 'RECURRING_PROBLEMS', 'EXTRACTED_KEYWORDS', 'LOCAL_REGULATIONS', 'BUDGET_ESTIMATION', 'BUSINESS_MODEL', 'TARGET_USERS', 'VALUE_PROPOSITION', 'REVENUE_MODEL', 'FEASIBILITY_ASSESSMENT', 'IMPLEMENTATION_TIMELINE', 'MARKET_POTENTIAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "account_status" "AccountStatus" NOT NULL DEFAULT 'NORMAL',
    "free_generation_limit" INTEGER NOT NULL DEFAULT 3,
    "free_generations_used" INTEGER NOT NULL DEFAULT 0,
    "credit_balance" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "credit_price" DECIMAL(10,2) NOT NULL,
    "bonus_threshold" INTEGER NOT NULL DEFAULT 0,
    "bonus_credits" INTEGER NOT NULL DEFAULT 0,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "has_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "guest_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_session_id" TEXT,
    "title" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "limited_abstract" TEXT,
    "partial_abstract" TEXT,
    "full_abstract" TEXT,
    "problem_statement" TEXT,
    "objectives" TEXT,
    "target_users" TEXT,
    "generation_type" "IdeaGenerationType" NOT NULL,
    "is_unlocked" BOOLEAN NOT NULL DEFAULT false,
    "unlock_method" "UnlockMethod" NOT NULL DEFAULT 'NONE',
    "unlocked_at" TIMESTAMP(3),
    "comments_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idea_id" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payment_method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payment_purpose" "PaymentPurpose" NOT NULL,
    "credits_amount" INTEGER NOT NULL DEFAULT 0,
    "credit_price_at_purchase" DECIMAL(10,2),
    "transaction_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "idea_id" TEXT,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_platform" TEXT,
    "sentiment" TEXT,
    "language" TEXT,
    "source_url" TEXT,
    "region" TEXT,
    "collected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_comments" (
    "id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,

    CONSTRAINT "idea_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_outputs" (
    "id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "output_type" "GeneratedOutputType" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "AlertType" NOT NULL DEFAULT 'SYSTEM',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idea_id" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "ComplaintPriority" NOT NULL DEFAULT 'MEDIUM',
    "admin_reply" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_api_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "idea_id" TEXT,
    "provider" "ApiProvider" NOT NULL,
    "endpoint" TEXT,
    "request_type" "ApiRequestType" NOT NULL,
    "status_code" INTEGER,
    "is_success" BOOLEAN NOT NULL DEFAULT false,
    "response_time_ms" INTEGER,
    "error_message" TEXT,
    "cost_estimate" DECIMAL(10,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "guest_sessions_session_token_key" ON "guest_sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "idea_comments_idea_id_comment_id_key" ON "idea_comments"("idea_id", "comment_id");

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_comments" ADD CONSTRAINT "idea_comments_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_comments" ADD CONSTRAINT "idea_comments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_outputs" ADD CONSTRAINT "generated_outputs_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_api_logs" ADD CONSTRAINT "external_api_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_api_logs" ADD CONSTRAINT "external_api_logs_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
