/*
  Warnings:

  - The values [ADMIN_CREATE_PLATFORM,ADMIN_UPDATE_PLATFORM,ADMIN_DEACTIVATE_PLATFORM] on the enum `AuditAction` will be removed. If these variants are still used in the database, this will fail.
  - The values [PLATFORM] on the enum `AuditTargetType` will be removed. If these variants are still used in the database, this will fail.
  - The values [SUCCESS] on the enum `PaymentStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `provider` on the `ai_models` table. All the data in the column will be lost.
  - You are about to drop the column `platforms` on the `collection_jobs` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `external_api_logs` table. All the data in the column will be lost.
  - You are about to drop the column `output_type` on the `generated_outputs` table. All the data in the column will be lost.
  - You are about to drop the column `average_rating` on the `ideas` table. All the data in the column will be lost.
  - You are about to drop the column `ratings_count` on the `ideas` table. All the data in the column will be lost.
  - You are about to drop the column `selected_platform_id` on the `ideas` table. All the data in the column will be lost.
  - You are about to drop the column `payment_method` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `platforms` on the `saved_generation_searches` table. All the data in the column will be lost.
  - You are about to drop the column `language` on the `social_comments` table. All the data in the column will be lost.
  - You are about to drop the column `language` on the `social_posts` table. All the data in the column will be lost.
  - You are about to drop the column `platform_id` on the `social_posts` table. All the data in the column will be lost.
  - You are about to drop the column `source_type` on the `social_posts` table. All the data in the column will be lost.
  - You are about to drop the column `preferred_platforms` on the `user_preferences` table. All the data in the column will be lost.
  - The `preferred_language` column on the `user_preferences` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `favorite_ideas` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `idea_feedback` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `platforms` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[provider_key,api_model_id]` on the table `ai_models` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[payment_id,type]` on the table `credit_transactions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[idea_id,output_key]` on the table `generated_outputs` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[idempotency_key]` on the table `payments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[collection_job_id,data_source_id,external_id]` on the table `social_posts` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `provider_key` to the `ai_models` table without a default value. This is not possible if the table is not empty.
  - Added the required column `provider_key` to the `external_api_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `service_category` to the `external_api_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `output_key` to the `generated_outputs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `generated_outputs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payment_method_key` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `provider_key` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `data_source_id` to the `social_posts` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "IdeaGenerationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IdeaGenerationStageStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExternalServiceCategory" AS ENUM ('AI', 'PAYMENT', 'DATA_COLLECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "IdeaPublicationVisibility" AS ENUM ('REGISTERED_USERS', 'SELECTED_AUDIENCE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "IdeaPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IdeaVoteValue" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "PublicationFeedbackStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'REPORTED');

-- CreateEnum
CREATE TYPE "GeneratedOutputStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "AuditAction_new" AS ENUM ('ADMIN_UPDATE_USER_STATUS', 'ADMIN_SOFT_DELETE_USER', 'ADMIN_ADJUST_USER_CREDITS', 'ADMIN_SEND_PASSWORD_RESET_EMAIL', 'ADMIN_UPDATE_SETTINGS', 'ADMIN_UPDATE_PROMPT', 'ADMIN_CREATE_ALERT', 'ADMIN_CREATE_DATA_SOURCE', 'ADMIN_UPDATE_DATA_SOURCE', 'ADMIN_ACTIVATE_DATA_SOURCE', 'ADMIN_DEACTIVATE_DATA_SOURCE', 'ADMIN_CREATE_DOMAIN', 'ADMIN_UPDATE_DOMAIN', 'ADMIN_DEACTIVATE_DOMAIN', 'ADMIN_UPDATE_COMPLAINT', 'ADMIN_UPDATE_CONTACT_MESSAGE', 'ADMIN_CREATE_AI_MODEL', 'ADMIN_UPDATE_AI_MODEL', 'ADMIN_ACTIVATE_AI_MODEL', 'ADMIN_DEACTIVATE_AI_MODEL', 'ADMIN_SET_DEFAULT_AI_MODEL', 'RUN_DATA_COLLECTION', 'COMPLETE_DATA_COLLECTION', 'FAIL_DATA_COLLECTION', 'STOP_DATA_COLLECTION', 'ADMIN_START_DATA_COLLECTION', 'ADMIN_STOP_DATA_COLLECTION', 'USER_GENERATE_IDEA', 'USER_UNLOCK_IDEA', 'USER_CREATE_COMPLAINT', 'USER_CREATE_CONTACT_MESSAGE', 'USER_AI_CHAT', 'USER_UPDATE_PROFILE', 'USER_MARK_NOTIFICATION_READ', 'USER_MARK_ALL_NOTIFICATIONS_READ', 'NLP_ANALYSIS_RUN', 'ABSTRACT_GENERATION_RUN', 'PROMPT_HISTORY_CREATED', 'USER_CREATE_PUBLICATION', 'USER_PUBLISH_IDEA', 'USER_UPDATE_PUBLICATION', 'USER_ARCHIVE_PUBLICATION');
ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "AuditAction_new" USING ("action"::text::"AuditAction_new");
ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";
DROP TYPE "public"."AuditAction_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "AuditTargetType_new" AS ENUM ('USER', 'IDEA', 'PAYMENT', 'DOMAIN', 'DATA_SOURCE', 'SYSTEM_SETTING', 'PROMPT', 'COMPLAINT', 'AI_MODEL', 'IDEA_PUBLICATION', 'CONTACT_MESSAGE', 'ALERT', 'CREDIT_TRANSACTION', 'DATA_COLLECTION', 'NLP_ANALYSIS');
ALTER TABLE "audit_logs" ALTER COLUMN "target_type" TYPE "AuditTargetType_new" USING ("target_type"::text::"AuditTargetType_new");
ALTER TYPE "AuditTargetType" RENAME TO "AuditTargetType_old";
ALTER TYPE "AuditTargetType_new" RENAME TO "AuditTargetType";
DROP TYPE "public"."AuditTargetType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');
ALTER TABLE "public"."payments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "public"."PaymentStatus_old";
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."email_verification_tokens" DROP CONSTRAINT "email_verification_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."favorite_ideas" DROP CONSTRAINT "favorite_ideas_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "public"."favorite_ideas" DROP CONSTRAINT "favorite_ideas_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."idea_feedback" DROP CONSTRAINT "idea_feedback_idea_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."idea_feedback" DROP CONSTRAINT "idea_feedback_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ideas" DROP CONSTRAINT "ideas_guest_session_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ideas" DROP CONSTRAINT "ideas_selected_platform_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."social_posts" DROP CONSTRAINT "social_posts_platform_id_fkey";

-- DropIndex
DROP INDEX "public"."ai_models_created_at_idx";

-- DropIndex
DROP INDEX "public"."ai_models_is_active_health_status_idx";

-- DropIndex
DROP INDEX "public"."ai_models_provider_api_model_id_key";

-- DropIndex
DROP INDEX "public"."ai_models_provider_is_active_idx";

-- DropIndex
DROP INDEX "public"."ai_models_provider_model_name_key";

-- DropIndex
DROP INDEX "public"."chat_messages_created_at_idx";

-- DropIndex
DROP INDEX "public"."chat_messages_session_id_idx";

-- DropIndex
DROP INDEX "public"."external_api_logs_ai_model_id_idx";

-- DropIndex
DROP INDEX "public"."external_api_logs_provider_created_at_idx";

-- DropIndex
DROP INDEX "public"."generated_outputs_idea_id_output_type_key";

-- DropIndex
DROP INDEX "public"."payments_provider_idx";

-- DropIndex
DROP INDEX "public"."social_comments_language_idx";

-- DropIndex
DROP INDEX "public"."social_posts_collection_job_id_source_type_external_id_key";

-- DropIndex
DROP INDEX "public"."social_posts_language_idx";

-- DropIndex
DROP INDEX "public"."social_posts_platform_id_idx";

-- AlterTable
ALTER TABLE "ai_models" DROP COLUMN "provider",
ADD COLUMN     "context_window" INTEGER,
ADD COLUMN     "provider_key" TEXT NOT NULL,
ADD COLUMN     "supports_json_output" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supports_tools" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supports_vision" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "collection_jobs" DROP COLUMN "platforms",
ALTER COLUMN "country" DROP NOT NULL;

-- AlterTable
ALTER TABLE "external_api_logs" DROP COLUMN "provider",
ADD COLUMN     "provider_key" TEXT NOT NULL,
ADD COLUMN     "service_category" "ExternalServiceCategory" NOT NULL;

-- AlterTable
ALTER TABLE "generated_outputs" DROP COLUMN "output_type",
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "generated_at" TIMESTAMP(3),
ADD COLUMN     "output_key" TEXT NOT NULL,
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "GeneratedOutputStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "structured_content" JSONB,
ADD COLUMN     "title" TEXT NOT NULL,
ALTER COLUMN "content" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ideas" DROP COLUMN "average_rating",
DROP COLUMN "ratings_count",
DROP COLUMN "selected_platform_id";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "payment_method",
DROP COLUMN "provider",
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "payment_method_key" TEXT NOT NULL,
ADD COLUMN     "provider_key" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "saved_generation_searches" DROP COLUMN "platforms",
ADD COLUMN     "data_source_keys" JSONB;

-- AlterTable
ALTER TABLE "social_comments" DROP COLUMN "language",
ADD COLUMN     "language_code" TEXT;

-- AlterTable
ALTER TABLE "social_posts" DROP COLUMN "language",
DROP COLUMN "platform_id",
DROP COLUMN "source_type",
ADD COLUMN     "data_source_id" TEXT NOT NULL,
ADD COLUMN     "language_code" TEXT,
ALTER COLUMN "country" DROP NOT NULL;

-- AlterTable
ALTER TABLE "user_preferences" DROP COLUMN "preferred_platforms",
ADD COLUMN     "preferred_data_sources" JSONB,
DROP COLUMN "preferred_language",
ADD COLUMN     "preferred_language" "LanguageCode";

-- DropTable
DROP TABLE "public"."favorite_ideas";

-- DropTable
DROP TABLE "public"."idea_feedback";

-- DropTable
DROP TABLE "public"."platforms";

-- DropEnum
DROP TYPE "public"."AiProviderType";

-- DropEnum
DROP TYPE "public"."ApiProvider";

-- DropEnum
DROP TYPE "public"."CollectionSourceType";

-- DropEnum
DROP TYPE "public"."GeneratedOutputType";

-- DropEnum
DROP TYPE "public"."PaymentMethod";

-- DropEnum
DROP TYPE "public"."PaymentProvider";

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_implemented" BOOLEAN NOT NULL DEFAULT false,
    "supports_posts" BOOLEAN NOT NULL DEFAULT true,
    "supports_comments" BOOLEAN NOT NULL DEFAULT false,
    "supports_region" BOOLEAN NOT NULL DEFAULT false,
    "supports_language" BOOLEAN NOT NULL DEFAULT false,
    "configuration" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_job_sources" (
    "id" TEXT NOT NULL,
    "collection_job_id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "status" "CollectionJobStatus" NOT NULL DEFAULT 'PENDING',
    "total_posts" INTEGER NOT NULL DEFAULT 0,
    "total_comments" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_reason" TEXT,

    CONSTRAINT "collection_job_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_publications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_publications" (
    "id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "publisher_id" TEXT NOT NULL,
    "status" "IdeaPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "IdeaPublicationVisibility" NOT NULL,
    "public_title" TEXT NOT NULL,
    "public_abstract" TEXT,
    "public_problem" TEXT,
    "public_objectives" TEXT,
    "public_target_users" TEXT,
    "allow_ratings" BOOLEAN NOT NULL DEFAULT true,
    "allow_feedback" BOOLEAN NOT NULL DEFAULT true,
    "allow_voting" BOOLEAN NOT NULL DEFAULT true,
    "average_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratings_count" INTEGER NOT NULL DEFAULT 0,
    "upvotes_count" INTEGER NOT NULL DEFAULT 0,
    "downvotes_count" INTEGER NOT NULL DEFAULT 0,
    "feedback_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_publication_audiences" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "audience_type" TEXT NOT NULL,
    "audience_value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_publication_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_publication_votes" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value" "IdeaVoteValue" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_publication_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_publication_ratings" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_publication_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_publication_feedback" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "status" "PublicationFeedbackStatus" NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_publication_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_generation_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_session_id" TEXT,
    "last_heartbeat_at" TIMESTAMP(3),
    "cancel_requested_at" TIMESTAMP(3),
    "idea_id" TEXT,
    "collection_job_id" TEXT,
    "generation_type" "IdeaGenerationType" NOT NULL,
    "status" "IdeaGenerationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "current_stage_key" TEXT,
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_generation_stages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "stage_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "IdeaGenerationStageStatus" NOT NULL DEFAULT 'PENDING',
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "result_preview" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "idea_generation_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_publication_revisions" (
    "id" TEXT NOT NULL,
    "publication_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "public_title" TEXT NOT NULL,
    "public_abstract" TEXT NOT NULL,
    "public_problem" TEXT,
    "public_objectives" TEXT,
    "public_target_users" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_publication_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_key_key" ON "data_sources"("key");

-- CreateIndex
CREATE INDEX "data_sources_is_active_idx" ON "data_sources"("is_active");

-- CreateIndex
CREATE INDEX "data_sources_is_implemented_idx" ON "data_sources"("is_implemented");

-- CreateIndex
CREATE INDEX "collection_job_sources_collection_job_id_idx" ON "collection_job_sources"("collection_job_id");

-- CreateIndex
CREATE INDEX "collection_job_sources_data_source_id_idx" ON "collection_job_sources"("data_source_id");

-- CreateIndex
CREATE INDEX "collection_job_sources_status_idx" ON "collection_job_sources"("status");

-- CreateIndex
CREATE UNIQUE INDEX "collection_job_sources_collection_job_id_data_source_id_key" ON "collection_job_sources"("collection_job_id", "data_source_id");

-- CreateIndex
CREATE INDEX "favorite_publications_user_id_idx" ON "favorite_publications"("user_id");

-- CreateIndex
CREATE INDEX "favorite_publications_publication_id_idx" ON "favorite_publications"("publication_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_publications_user_id_publication_id_key" ON "favorite_publications"("user_id", "publication_id");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publications_idea_id_key" ON "idea_publications"("idea_id");

-- CreateIndex
CREATE INDEX "idea_publications_status_visibility_published_at_idx" ON "idea_publications"("status", "visibility", "published_at");

-- CreateIndex
CREATE INDEX "idea_publications_publisher_id_status_created_at_idx" ON "idea_publications"("publisher_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "idea_publications_status_published_at_idx" ON "idea_publications"("status", "published_at");

-- CreateIndex
CREATE INDEX "idea_publications_publisher_id_idx" ON "idea_publications"("publisher_id");

-- CreateIndex
CREATE INDEX "idea_publications_average_rating_idx" ON "idea_publications"("average_rating");

-- CreateIndex
CREATE INDEX "idea_publications_upvotes_count_idx" ON "idea_publications"("upvotes_count");

-- CreateIndex
CREATE INDEX "idea_publication_audiences_audience_type_audience_value_idx" ON "idea_publication_audiences"("audience_type", "audience_value");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_audiences_publication_id_audience_type_aud_key" ON "idea_publication_audiences"("publication_id", "audience_type", "audience_value");

-- CreateIndex
CREATE INDEX "idea_publication_votes_user_id_idx" ON "idea_publication_votes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_votes_publication_id_user_id_key" ON "idea_publication_votes"("publication_id", "user_id");

-- CreateIndex
CREATE INDEX "idea_publication_ratings_publication_id_idx" ON "idea_publication_ratings"("publication_id");

-- CreateIndex
CREATE INDEX "idea_publication_ratings_user_id_idx" ON "idea_publication_ratings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_ratings_publication_id_user_id_key" ON "idea_publication_ratings"("publication_id", "user_id");

-- CreateIndex
CREATE INDEX "idea_publication_feedback_publication_id_status_idx" ON "idea_publication_feedback"("publication_id", "status");

-- CreateIndex
CREATE INDEX "idea_publication_feedback_user_id_idx" ON "idea_publication_feedback"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_feedback_publication_id_user_id_key" ON "idea_publication_feedback"("publication_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idea_generation_runs_idea_id_key" ON "idea_generation_runs"("idea_id");

-- CreateIndex
CREATE INDEX "idea_generation_runs_user_id_created_at_idx" ON "idea_generation_runs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idea_generation_runs_status_idx" ON "idea_generation_runs"("status");

-- CreateIndex
CREATE INDEX "idea_generation_runs_collection_job_id_idx" ON "idea_generation_runs"("collection_job_id");

-- CreateIndex
CREATE INDEX "idea_generation_stages_run_id_sequence_idx" ON "idea_generation_stages"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "idea_generation_stages_status_idx" ON "idea_generation_stages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "idea_generation_stages_run_id_stage_key_key" ON "idea_generation_stages"("run_id", "stage_key");

-- CreateIndex
CREATE INDEX "idea_publication_revisions_publication_id_created_at_idx" ON "idea_publication_revisions"("publication_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_revisions_publication_id_version_key" ON "idea_publication_revisions"("publication_id", "version");

-- CreateIndex
CREATE INDEX "ai_models_provider_key_is_active_idx" ON "ai_models"("provider_key", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_provider_key_api_model_id_key" ON "ai_models"("provider_key", "api_model_id");

-- CreateIndex
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_payment_id_type_key" ON "credit_transactions"("payment_id", "type");

-- CreateIndex
CREATE INDEX "external_api_logs_ai_model_id_created_at_idx" ON "external_api_logs"("ai_model_id", "created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_provider_key_created_at_idx" ON "external_api_logs"("provider_key", "created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_service_category_created_at_idx" ON "external_api_logs"("service_category", "created_at");

-- CreateIndex
CREATE INDEX "generated_outputs_idea_id_sequence_idx" ON "generated_outputs"("idea_id", "sequence");

-- CreateIndex
CREATE INDEX "generated_outputs_status_idx" ON "generated_outputs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "generated_outputs_idea_id_output_key_key" ON "generated_outputs"("idea_id", "output_key");

-- CreateIndex
CREATE INDEX "ideas_user_id_created_at_idx" ON "ideas"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ideas_guest_session_id_idx" ON "ideas"("guest_session_id");

-- CreateIndex
CREATE INDEX "ideas_generation_type_idx" ON "ideas"("generation_type");

-- CreateIndex
CREATE INDEX "ideas_is_unlocked_idx" ON "ideas"("is_unlocked");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_provider_key_idx" ON "payments"("provider_key");

-- CreateIndex
CREATE INDEX "payments_payment_method_key_idx" ON "payments"("payment_method_key");

-- CreateIndex
CREATE INDEX "social_comments_language_code_idx" ON "social_comments"("language_code");

-- CreateIndex
CREATE INDEX "social_posts_data_source_id_idx" ON "social_posts"("data_source_id");

-- CreateIndex
CREATE INDEX "social_posts_language_code_idx" ON "social_posts"("language_code");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_collection_job_id_data_source_id_external_id_key" ON "social_posts"("collection_job_id", "data_source_id", "external_id");

-- AddForeignKey
ALTER TABLE "collection_job_sources" ADD CONSTRAINT "collection_job_sources_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_job_sources" ADD CONSTRAINT "collection_job_sources_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_publications" ADD CONSTRAINT "favorite_publications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_publications" ADD CONSTRAINT "favorite_publications_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publications" ADD CONSTRAINT "idea_publications_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publications" ADD CONSTRAINT "idea_publications_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_audiences" ADD CONSTRAINT "idea_publication_audiences_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_votes" ADD CONSTRAINT "idea_publication_votes_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_votes" ADD CONSTRAINT "idea_publication_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_ratings" ADD CONSTRAINT "idea_publication_ratings_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_ratings" ADD CONSTRAINT "idea_publication_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_feedback" ADD CONSTRAINT "idea_publication_feedback_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_feedback" ADD CONSTRAINT "idea_publication_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_generation_runs" ADD CONSTRAINT "idea_generation_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_generation_runs" ADD CONSTRAINT "idea_generation_runs_guest_session_id_fkey" FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_generation_runs" ADD CONSTRAINT "idea_generation_runs_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_generation_runs" ADD CONSTRAINT "idea_generation_runs_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_generation_stages" ADD CONSTRAINT "idea_generation_stages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "idea_generation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_publication_revisions" ADD CONSTRAINT "idea_publication_revisions_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "idea_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- NEXORA AI - DATABASE INTEGRITY CONSTRAINTS
-- PostgreSQL / Prisma Migration
-- ============================================================

-- ============================================================
-- 1. IDEAS
-- ============================================================

-- Every idea must belong to exactly one owner:
-- either an authenticated user or a guest session.
ALTER TABLE "ideas"
ADD CONSTRAINT "ideas_exactly_one_owner_check"
CHECK (
  (
    "user_id" IS NOT NULL
    AND "guest_session_id" IS NULL
  )
  OR
  (
    "user_id" IS NULL
    AND "guest_session_id" IS NOT NULL
  )
);

-- Ensures unlock fields always represent a valid state.
ALTER TABLE "ideas"
ADD CONSTRAINT "ideas_unlock_consistency_check"
CHECK (
  (
    "is_unlocked" = FALSE
    AND "unlock_method" = 'NONE'
    AND "unlocked_at" IS NULL
  )
  OR
  (
    "is_unlocked" = TRUE
    AND "unlock_method" <> 'NONE'
    AND "unlocked_at" IS NOT NULL
  )
);

-- Idea counters must never be negative.
ALTER TABLE "ideas"
ADD CONSTRAINT "ideas_comments_count_check"
CHECK (
  "comments_count" >= 0
);

-- ============================================================
-- 2. IDEA GENERATION RUNS
-- ============================================================

-- Every generation run must belong to exactly one owner.
ALTER TABLE "idea_generation_runs"
ADD CONSTRAINT "generation_runs_exactly_one_owner_check"
CHECK (
  (
    "user_id" IS NOT NULL
    AND "guest_session_id" IS NULL
  )
  OR
  (
    "user_id" IS NULL
    AND "guest_session_id" IS NOT NULL
  )
);

-- Overall progress must remain between 0 and 100.
ALTER TABLE "idea_generation_runs"
ADD CONSTRAINT "generation_runs_progress_check"
CHECK (
  "progress_percent" BETWEEN 0 AND 100
);

-- Run timestamps must be chronologically valid.
ALTER TABLE "idea_generation_runs"
ADD CONSTRAINT "generation_runs_dates_check"
CHECK (
  (
    "started_at" IS NULL
    OR "started_at" >= "created_at"
  )
  AND
  (
    "completed_at" IS NULL
    OR "started_at" IS NULL
    OR "completed_at" >= "started_at"
  )
  AND
  (
    "cancel_requested_at" IS NULL
    OR "cancel_requested_at" >= "created_at"
  )
  AND
  (
    "last_heartbeat_at" IS NULL
    OR "started_at" IS NULL
    OR "last_heartbeat_at" >= "started_at"
  )
);

-- Completed runs must have completedAt and 100% progress.
-- Failed and cancelled runs must also have completion timestamps.
ALTER TABLE "idea_generation_runs"
ADD CONSTRAINT "generation_runs_status_consistency_check"
CHECK (
  (
    "status" = 'QUEUED'
    AND "started_at" IS NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'RUNNING'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'COMPLETED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
    AND "progress_percent" = 100
    AND "idea_id" IS NOT NULL
  )
  OR
  (
    "status" = 'FAILED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
  )
  OR
  (
    "status" = 'CANCELLED'
    AND "completed_at" IS NOT NULL
  )
);

-- ============================================================
-- 3. IDEA GENERATION STAGES
-- ============================================================

-- Stage progress must remain between 0 and 100.
ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "generation_stages_progress_check"
CHECK (
  "progress_percent" BETWEEN 0 AND 100
);

-- Retry counters must be valid.
ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "generation_stages_attempts_check"
CHECK (
  "attempt_count" >= 0
  AND "max_attempts" >= 1
  AND "attempt_count" <= "max_attempts"
);

-- Stage order must not be negative.
ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "generation_stages_sequence_check"
CHECK (
  "sequence" >= 0
);

-- Stage timestamps must be chronologically valid.
ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "generation_stages_dates_check"
CHECK (
  (
    "started_at" IS NULL
    OR "started_at" >= "created_at"
  )
  AND
  (
    "completed_at" IS NULL
    OR "started_at" IS NULL
    OR "completed_at" >= "started_at"
  )
);

-- Stage state must match its timestamps and progress.
ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "generation_stages_status_consistency_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "started_at" IS NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'RUNNING'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'COMPLETED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
    AND "progress_percent" = 100
  )
  OR
  (
    "status" = 'FAILED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
  )
  OR
  (
    "status" = 'SKIPPED'
    AND "completed_at" IS NOT NULL
  )
);

-- ============================================================
-- 4. GENERATED OUTPUTS
-- ============================================================

-- Display order must not be negative.
ALTER TABLE "generated_outputs"
ADD CONSTRAINT "generated_outputs_sequence_check"
CHECK (
  "sequence" >= 0
);

-- Completed outputs must contain generated content.
ALTER TABLE "generated_outputs"
ADD CONSTRAINT "generated_outputs_status_consistency_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "generated_at" IS NULL
  )
  OR
  (
    "status" = 'GENERATING'
    AND "generated_at" IS NULL
  )
  OR
  (
    "status" = 'COMPLETED'
    AND "generated_at" IS NOT NULL
    AND (
      "content" IS NOT NULL
      OR "structured_content" IS NOT NULL
    )
  )
  OR
  (
    "status" = 'FAILED'
    AND "error_message" IS NOT NULL
  )
);

-- ============================================================
-- 5. PAYMENTS
-- ============================================================

-- Payment amount must always be positive.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_amount_check"
CHECK (
  "amount" > 0
);

-- Credit quantities must never be negative.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_credit_amounts_check"
CHECK (
  "credits_amount" >= 0
  AND "bonus_credits_amount" >= 0
);

-- Currency must use a normalized three-letter uppercase code.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_currency_format_check"
CHECK (
  "currency" ~ '^[A-Z]{3}$'
);

-- Historical credit price must be positive when present.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_credit_price_check"
CHECK (
  "credit_price_at_purchase" IS NULL
  OR "credit_price_at_purchase" > 0
);

-- Payment fields must match the payment purpose.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_purpose_consistency_check"
CHECK (
  (
    "payment_purpose" = 'BUY_CREDITS'
    AND "idea_id" IS NULL
    AND "credits_amount" > 0
  )
  OR
  (
    "payment_purpose" = 'DIRECT_UNLOCK'
    AND "idea_id" IS NOT NULL
    AND "credits_amount" = 0
    AND "bonus_credits_amount" = 0
  )
);

-- Payment status must match its timestamps.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_status_timestamp_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "paid_at" IS NULL
    AND "failed_at" IS NULL
    AND "refunded_at" IS NULL
  )
  OR
  (
    "status" = 'SUCCEEDED'
    AND "paid_at" IS NOT NULL
    AND "failed_at" IS NULL
    AND "refunded_at" IS NULL
  )
  OR
  (
    "status" = 'FAILED'
    AND "failed_at" IS NOT NULL
    AND "paid_at" IS NULL
    AND "refunded_at" IS NULL
  )
  OR
  (
    "status" = 'REFUNDED'
    AND "paid_at" IS NOT NULL
    AND "refunded_at" IS NOT NULL
  )
);

-- A failed payment should contain a failure reason.
ALTER TABLE "payments"
ADD CONSTRAINT "payments_failure_reason_check"
CHECK (
  "status" <> 'FAILED'
  OR (
    "failure_reason" IS NOT NULL
    AND LENGTH(TRIM("failure_reason")) > 0
  )
);

-- ============================================================
-- 6. CREDIT TRANSACTIONS
-- ============================================================

-- Resulting user balance must never be negative.
ALTER TABLE "credit_transactions"
ADD CONSTRAINT "credit_transactions_balance_check"
CHECK (
  "balance_after" >= 0
);

-- Transaction amount cannot be zero.
ALTER TABLE "credit_transactions"
ADD CONSTRAINT "credit_transactions_amount_check"
CHECK (
  "amount" <> 0
);

-- Credit transaction direction must match its type.
ALTER TABLE "credit_transactions"
ADD CONSTRAINT "credit_transactions_type_amount_check"
CHECK (
  (
    "type" IN (
      'PURCHASE',
      'BONUS',
      'REFUND'
    )
    AND "amount" > 0
  )
  OR
  (
    "type" = 'DEDUCTION_GENERATION'
    AND "amount" < 0
    AND "idea_id" IS NOT NULL
  )
  OR
  (
    "type" = 'ADMIN_ADJUSTMENT'
    AND "amount" <> 0
  )
);

-- ============================================================
-- 7. USERS
-- ============================================================

-- User credit balance must never become negative.
ALTER TABLE "users"
ADD CONSTRAINT "users_credit_balance_check"
CHECK (
  "credit_balance" >= 0
);

-- Free-generation counters must never be negative.
ALTER TABLE "users"
ADD CONSTRAINT "users_generation_limits_check"
CHECK (
  "free_generation_limit" >= 0
  AND "free_generations_used" >= 0
);

-- Login-security counters must never be negative.
ALTER TABLE "users"
ADD CONSTRAINT "users_security_counters_check"
CHECK (
  "failed_login_attempts" >= 0
  AND "login_lock_level" >= 0
);

-- Verified users should have a verification timestamp.
ALTER TABLE "users"
ADD CONSTRAINT "users_verification_consistency_check"
CHECK (
  (
    "is_verified" = FALSE
  )
  OR
  (
    "is_verified" = TRUE
    AND "email_verified_at" IS NOT NULL
  )
);

-- ============================================================
-- 8. SYSTEM SETTINGS
-- ============================================================

-- Only the global settings key is allowed.
-- Combined with the existing UNIQUE constraint, this permits
-- at most one system-settings record.
ALTER TABLE "system_settings"
ADD CONSTRAINT "system_settings_global_key_check"
CHECK (
  "key" = 'GLOBAL'
);

-- System prices and bonus values must be valid.
ALTER TABLE "system_settings"
ADD CONSTRAINT "system_settings_values_check"
CHECK (
  "credit_price" > 0
  AND "direct_unlock_price" > 0
  AND "bonus_threshold" >= 0
  AND "bonus_credits" >= 0
);

-- Bonus configuration must be logically consistent.
ALTER TABLE "system_settings"
ADD CONSTRAINT "system_settings_bonus_consistency_check"
CHECK (
  (
    "bonus_threshold" = 0
    AND "bonus_credits" = 0
  )
  OR
  (
    "bonus_threshold" > 0
    AND "bonus_credits" > 0
  )
);

-- ============================================================
-- 9. AI MODELS
-- ============================================================


-- AI model numeric values must remain valid.
ALTER TABLE "ai_models"
ADD CONSTRAINT "ai_models_numeric_values_check"
CHECK (
  "priority" >= 0
  AND "weight" >= 1
  AND "max_output_tokens" > 0
  AND "consecutive_failures" >= 0
  AND "input_cost_per_million" >= 0
  AND "output_cost_per_million" >= 0
  AND (
    "context_window" IS NULL
    OR "context_window" > 0
  )
);

-- Output-token limit cannot exceed the context window.
ALTER TABLE "ai_models"
ADD CONSTRAINT "ai_models_token_limits_check"
CHECK (
  "context_window" IS NULL
  OR "max_output_tokens" <= "context_window"
);

-- Provider and model identifiers cannot be blank.
ALTER TABLE "ai_models"
ADD CONSTRAINT "ai_models_identifiers_check"
CHECK (
  LENGTH(TRIM("provider_key")) > 0
  AND LENGTH(TRIM("model_name")) > 0
  AND LENGTH(TRIM("api_model_id")) > 0
);

-- ============================================================
-- 10. EXTERNAL API LOGS
-- ============================================================

-- External API numeric metrics must not be negative.
ALTER TABLE "external_api_logs"
ADD CONSTRAINT "external_api_logs_numeric_values_check"
CHECK (
  "attempt_number" >= 1
  AND (
    "status_code" IS NULL
    OR "status_code" BETWEEN 100 AND 599
  )
  AND (
    "response_time_ms" IS NULL
    OR "response_time_ms" >= 0
  )
  AND (
    "cost_estimate" IS NULL
    OR "cost_estimate" >= 0
  )
  AND (
    "input_tokens" IS NULL
    OR "input_tokens" >= 0
  )
  AND (
    "output_tokens" IS NULL
    OR "output_tokens" >= 0
  )
);

-- Failed requests should contain an error message.
ALTER TABLE "external_api_logs"
ADD CONSTRAINT "external_api_logs_error_consistency_check"
CHECK (
  "is_success" = TRUE
  OR (
    "error_message" IS NOT NULL
    AND LENGTH(TRIM("error_message")) > 0
  )
);

-- ============================================================
-- 11. IDEA PUBLICATIONS
-- ============================================================

-- Publication counters and rating values must remain valid.
ALTER TABLE "idea_publications"
ADD CONSTRAINT "idea_publications_counts_check"
CHECK (
  "ratings_count" >= 0
  AND "upvotes_count" >= 0
  AND "downvotes_count" >= 0
  AND "feedback_count" >= 0
  AND "average_rating" BETWEEN 0 AND 5
);

-- A zero rating count must have an average of zero.
ALTER TABLE "idea_publications"
ADD CONSTRAINT "idea_publications_rating_consistency_check"
CHECK (
  (
    "ratings_count" = 0
    AND "average_rating" = 0
  )
  OR
  (
    "ratings_count" > 0
    AND "average_rating" > 0
    AND "average_rating" <= 5
  )
);

-- Publication state must match public content and timestamps.
ALTER TABLE "idea_publications"
ADD CONSTRAINT "idea_publications_status_check"
CHECK (
  (
    "status" = 'DRAFT'
    AND "published_at" IS NULL
    AND "archived_at" IS NULL
  )
  OR
  (
    "status" = 'PUBLISHED'
    AND "public_abstract" IS NOT NULL
    AND LENGTH(TRIM("public_abstract")) > 0
    AND "published_at" IS NOT NULL
    AND "archived_at" IS NULL
  )
  OR
  (
    "status" = 'ARCHIVED'
    AND "archived_at" IS NOT NULL
    AND (
      "published_at" IS NULL
      OR "archived_at" >= "published_at"
    )
  )
);

-- Public title cannot be blank.
ALTER TABLE "idea_publications"
ADD CONSTRAINT "idea_publications_title_check"
CHECK (
  LENGTH(TRIM("public_title")) > 0
);

-- ============================================================
-- 12. PUBLICATION RATINGS
-- ============================================================

-- Ratings must be between one and five.
ALTER TABLE "idea_publication_ratings"
ADD CONSTRAINT "idea_publication_ratings_value_check"
CHECK (
  "value" BETWEEN 1 AND 5
);

-- ============================================================
-- 13. PUBLICATION FEEDBACK
-- ============================================================

-- Feedback comments cannot be blank.
ALTER TABLE "idea_publication_feedback"
ADD CONSTRAINT "idea_publication_feedback_comment_check"
CHECK (
  LENGTH(TRIM("comment")) > 0
);

-- ============================================================
-- 14. PUBLICATION AUDIENCES
-- ============================================================

-- Audience type and value cannot be blank.
ALTER TABLE "idea_publication_audiences"
ADD CONSTRAINT "idea_publication_audiences_values_check"
CHECK (
  LENGTH(TRIM("audience_type")) > 0
  AND LENGTH(TRIM("audience_value")) > 0
);

-- ============================================================
-- 15. PUBLICATION REVISIONS
-- ============================================================

-- Revision version numbers begin at one.
ALTER TABLE "idea_publication_revisions"
ADD CONSTRAINT "idea_publication_revisions_version_check"
CHECK (
  "version" >= 1
);

-- Revision title and abstract cannot be blank.
ALTER TABLE "idea_publication_revisions"
ADD CONSTRAINT "idea_publication_revisions_content_check"
CHECK (
  LENGTH(TRIM("public_title")) > 0
  AND LENGTH(TRIM("public_abstract")) > 0
);

-- ============================================================
-- 16. COLLECTION JOBS
-- ============================================================

-- Job totals and geographic radius must be valid.
ALTER TABLE "collection_jobs"
ADD CONSTRAINT "collection_jobs_numeric_values_check"
CHECK (
  "total_posts" >= 0
  AND "total_comments" >= 0
  AND (
    "radius_km" IS NULL
    OR "radius_km" > 0
  )
);

-- Collection-job timestamps must be chronologically valid.
ALTER TABLE "collection_jobs"
ADD CONSTRAINT "collection_jobs_dates_check"
CHECK (
  (
    "started_at" IS NULL
    OR "started_at" >= "created_at"
  )
  AND
  (
    "completed_at" IS NULL
    OR "started_at" IS NULL
    OR "completed_at" >= "started_at"
  )
);

-- Job state must match its timestamps.
ALTER TABLE "collection_jobs"
ADD CONSTRAINT "collection_jobs_status_consistency_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "started_at" IS NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'RUNNING'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'COMPLETED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
  )
  OR
  (
    "status" = 'FAILED'
    AND "completed_at" IS NOT NULL
    AND "failed_reason" IS NOT NULL
  )
  OR
  (
    "status" = 'STOPPED'
    AND "completed_at" IS NOT NULL
  )
);

-- ============================================================
-- 17. COLLECTION JOB SOURCES
-- ============================================================

-- Per-source totals must never be negative.
ALTER TABLE "collection_job_sources"
ADD CONSTRAINT "collection_job_sources_counts_check"
CHECK (
  "total_posts" >= 0
  AND "total_comments" >= 0
);

-- Per-source timestamps must be chronologically valid.
ALTER TABLE "collection_job_sources"
ADD CONSTRAINT "collection_job_sources_dates_check"
CHECK (
  (
    "started_at" IS NULL
    OR "completed_at" IS NULL
    OR "completed_at" >= "started_at"
  )
);

-- Per-source state must match its timestamps.
ALTER TABLE "collection_job_sources"
ADD CONSTRAINT "collection_job_sources_status_consistency_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "started_at" IS NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'RUNNING'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
  )
  OR
  (
    "status" = 'COMPLETED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
  )
  OR
  (
    "status" = 'FAILED'
    AND "completed_at" IS NOT NULL
    AND "failure_reason" IS NOT NULL
  )
  OR
  (
    "status" = 'STOPPED'
    AND "completed_at" IS NOT NULL
  )
);

-- ============================================================
-- 18. DATA SOURCES
-- ============================================================

-- Source keys and display names cannot be blank.
ALTER TABLE "data_sources"
ADD CONSTRAINT "data_sources_values_check"
CHECK (
  LENGTH(TRIM("key")) > 0
  AND LENGTH(TRIM("display_name")) > 0
);

-- Source keys must be normalized.
ALTER TABLE "data_sources"
ADD CONSTRAINT "data_sources_key_format_check"
CHECK (
  "key" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
);

-- ============================================================
-- 19. SOCIAL POSTS
-- ============================================================

-- Post counters must never be negative.
ALTER TABLE "social_posts"
ADD CONSTRAINT "social_posts_counts_check"
CHECK (
  "likes_count" >= 0
  AND "replies_count" >= 0
);

-- Post content and external identifier cannot be blank.
ALTER TABLE "social_posts"
ADD CONSTRAINT "social_posts_required_text_check"
CHECK (
  LENGTH(TRIM("external_id")) > 0
  AND LENGTH(TRIM("content")) > 0
);

-- Collected time should not precede creation time.
ALTER TABLE "social_posts"
ADD CONSTRAINT "social_posts_dates_check"
CHECK (
  "collected_at" >= "created_at"
);

-- ============================================================
-- 20. SOCIAL COMMENTS
-- ============================================================

-- Comment likes must never be negative.
ALTER TABLE "social_comments"
ADD CONSTRAINT "social_comments_likes_check"
CHECK (
  "likes_count" >= 0
);

-- Comment content and external identifier cannot be blank.
ALTER TABLE "social_comments"
ADD CONSTRAINT "social_comments_required_text_check"
CHECK (
  LENGTH(TRIM("external_id")) > 0
  AND LENGTH(TRIM("content")) > 0
);

-- Collected time should not precede creation time.
ALTER TABLE "social_comments"
ADD CONSTRAINT "social_comments_dates_check"
CHECK (
  "collected_at" >= "created_at"
);

-- ============================================================
-- 21. NLP ANALYSIS
-- ============================================================

-- NLP confidence must be between zero and one.
ALTER TABLE "nlp_analyses"
ADD CONSTRAINT "nlp_analyses_confidence_check"
CHECK (
  "confidence" IS NULL
  OR "confidence" BETWEEN 0 AND 1
);

-- NLP analysis totals must not be negative.
ALTER TABLE "nlp_analyses"
ADD CONSTRAINT "nlp_analyses_totals_check"
CHECK (
  "total_texts_analyzed" >= 0
  AND "total_posts_analyzed" >= 0
  AND "total_comments_analyzed" >= 0
);

-- Total analyzed texts must equal posts plus comments.
ALTER TABLE "nlp_analyses"
ADD CONSTRAINT "nlp_analyses_total_consistency_check"
CHECK (
  "total_texts_analyzed"
  =
  "total_posts_analyzed" + "total_comments_analyzed"
);

-- ============================================================
-- 22. CHAT
-- ============================================================

-- Chat-session title cannot be blank when provided.
ALTER TABLE "chat_sessions"
ADD CONSTRAINT "chat_sessions_title_check"
CHECK (
  "title" IS NULL
  OR LENGTH(TRIM("title")) > 0
);

-- Chat messages cannot be blank.
ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_content_check"
CHECK (
  LENGTH(TRIM("message")) > 0
);

-- ============================================================
-- 23. COMPLAINTS
-- ============================================================

-- Complaint subject and message cannot be blank.
ALTER TABLE "complaints"
ADD CONSTRAINT "complaints_content_check"
CHECK (
  LENGTH(TRIM("subject")) > 0
  AND LENGTH(TRIM("message")) > 0
);

-- Resolved complaints should have a resolution timestamp.
ALTER TABLE "complaints"
ADD CONSTRAINT "complaints_status_consistency_check"
CHECK (
  (
    "status" NOT IN ('RESOLVED', 'REJECTED')
  )
  OR
  (
    "resolved_at" IS NOT NULL
  )
);

-- ============================================================
-- 24. CONTACT MESSAGES
-- ============================================================

-- Contact-message fields cannot be blank.
ALTER TABLE "contact_messages"
ADD CONSTRAINT "contact_messages_content_check"
CHECK (
  LENGTH(TRIM("fullName")) > 0
  AND LENGTH(TRIM("email")) > 0
  AND LENGTH(TRIM("subject")) > 0
  AND LENGTH(TRIM("message")) > 0
);

-- Replied contact messages should include an admin reply.
ALTER TABLE "contact_messages"
ADD CONSTRAINT "contact_messages_reply_consistency_check"
CHECK (
  "status" <> 'REPLIED'
  OR (
    "admin_reply" IS NOT NULL
    AND LENGTH(TRIM("admin_reply")) > 0
  )
);

-- ============================================================
-- 25. ALERTS
-- ============================================================

-- Alert title and message cannot be blank.
ALTER TABLE "alerts"
ADD CONSTRAINT "alerts_content_check"
CHECK (
  LENGTH(TRIM("title")) > 0
  AND LENGTH(TRIM("message")) > 0
);

-- ============================================================
-- 26. DOMAINS
-- ============================================================

-- Domain names cannot be blank.
ALTER TABLE "domains"
ADD CONSTRAINT "domains_name_check"
CHECK (
  LENGTH(TRIM("name")) > 0
);

-- ============================================================
-- 27. DOMAIN KEYWORDS
-- ============================================================

-- Domain keywords cannot be blank.
ALTER TABLE "domain_keywords"
ADD CONSTRAINT "domain_keywords_value_check"
CHECK (
  LENGTH(TRIM("keyword")) > 0
);

-- ============================================================
-- 28. NLP LEXICONS
-- ============================================================

-- Lexicon words cannot be blank.
ALTER TABLE "nlp_lexicons"
ADD CONSTRAINT "nlp_lexicons_word_check"
CHECK (
  LENGTH(TRIM("word")) > 0
);

-- ============================================================
-- 29. NLP TOPIC RULES
-- ============================================================

-- Topic names cannot be blank.
ALTER TABLE "nlp_topic_rules"
ADD CONSTRAINT "nlp_topic_rules_topic_check"
CHECK (
  LENGTH(TRIM("topic")) > 0
);

-- ============================================================
-- 30. GENERATION LOCKS
-- ============================================================

-- Lock values cannot be blank.
ALTER TABLE "idea_generation_locks"
ADD CONSTRAINT "idea_generation_locks_values_check"
CHECK (
  LENGTH(TRIM("lock_key")) > 0
  AND LENGTH(TRIM("owner_token")) > 0
);

-- Lock expiration must be later than its creation.
ALTER TABLE "idea_generation_locks"
ADD CONSTRAINT "idea_generation_locks_dates_check"
CHECK (
  "expires_at" > "created_at"
);

-- ============================================================
-- 31. AUTHENTICATION TOKENS
-- ============================================================

ALTER TABLE "refresh_tokens"
ADD CONSTRAINT "refresh_tokens_dates_check"
CHECK (
  "expires_at" > "created_at"
  AND (
    "revoked_at" IS NULL
    OR "revoked_at" >= "created_at"
  )
  AND (
    "last_used_at" IS NULL
    OR "last_used_at" >= "created_at"
  )
);

ALTER TABLE "password_reset_tokens"
ADD CONSTRAINT "password_reset_tokens_dates_check"
CHECK (
  "expires_at" > "created_at"
  AND (
    "used_at" IS NULL
    OR "used_at" >= "created_at"
  )
);

ALTER TABLE "email_verification_tokens"
ADD CONSTRAINT "email_verification_tokens_dates_check"
CHECK (
  "expires_at" > "created_at"
  AND (
    "used_at" IS NULL
    OR "used_at" >= "created_at"
  )
);

-- ============================================================
-- END OF NEXORA AI DATABASE CONSTRAINTS
-- ============================================================
