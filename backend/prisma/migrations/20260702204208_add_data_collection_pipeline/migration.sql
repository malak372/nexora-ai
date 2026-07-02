/*
  Warnings:

  - You are about to drop the column `ip_address` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `last_used_at` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `user_agent` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `email_verified_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `last_login_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `password_changed_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `comments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `idea_comments` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[collection_job_id]` on the table `ideas` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CollectionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'STOPPED');

-- CreateEnum
CREATE TYPE "CollectionSourceType" AS ENUM ('MOCK', 'REDDIT', 'FACEBOOK', 'YOUTUBE', 'LINKEDIN', 'FORUM', 'OTHER');

-- CreateEnum
CREATE TYPE "PromptType" AS ENUM ('IDEA_GENERATION', 'CHAT_RESPONSE', 'NLP_ANALYSIS', 'ABSTRACT_GENERATION');

-- DropForeignKey
ALTER TABLE "public"."comments" DROP CONSTRAINT "comments_platform_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."idea_comments" DROP CONSTRAINT "idea_comments_comment_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."idea_comments" DROP CONSTRAINT "idea_comments_idea_id_fkey";

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "collection_job_id" TEXT;

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "ip_address",
DROP COLUMN "last_used_at",
DROP COLUMN "user_agent";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "email_verified_at",
DROP COLUMN "last_login_at",
DROP COLUMN "password_changed_at";

-- DropTable
DROP TABLE "public"."comments";

-- DropTable
DROP TABLE "public"."idea_comments";

-- CreateTable
CREATE TABLE "collection_jobs" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "region" TEXT,
    "radius_km" INTEGER,
    "platforms" JSONB NOT NULL,
    "keywords" JSONB,
    "status" "CollectionJobStatus" NOT NULL DEFAULT 'PENDING',
    "total_posts" INTEGER NOT NULL DEFAULT 0,
    "total_comments" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "collection_job_id" TEXT NOT NULL,
    "platform_id" TEXT,
    "source_type" "CollectionSourceType" NOT NULL,
    "external_id" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "author" TEXT,
    "url" TEXT,
    "country" TEXT,
    "city" TEXT,
    "region" TEXT,
    "language" TEXT,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "replies_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "external_id" TEXT,
    "content" TEXT NOT NULL,
    "author" TEXT,
    "language" TEXT,
    "sentiment" TEXT,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nlp_analyses" (
    "id" TEXT NOT NULL,
    "collection_job_id" TEXT NOT NULL,
    "sentiment_stats" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "topics" JSONB,
    "recurring_problems" JSONB NOT NULL,
    "extracted_needs" JSONB,
    "sample_comments" JSONB,
    "statistics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nlp_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_histories" (
    "id" TEXT NOT NULL,
    "collection_job_id" TEXT,
    "idea_id" TEXT,
    "prompt_type" "PromptType" NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_jobs_domain_id_idx" ON "collection_jobs"("domain_id");

-- CreateIndex
CREATE INDEX "collection_jobs_status_idx" ON "collection_jobs"("status");

-- CreateIndex
CREATE INDEX "collection_jobs_created_at_idx" ON "collection_jobs"("created_at");

-- CreateIndex
CREATE INDEX "social_posts_collection_job_id_idx" ON "social_posts"("collection_job_id");

-- CreateIndex
CREATE INDEX "social_posts_platform_id_idx" ON "social_posts"("platform_id");

-- CreateIndex
CREATE INDEX "social_posts_region_idx" ON "social_posts"("region");

-- CreateIndex
CREATE INDEX "social_posts_language_idx" ON "social_posts"("language");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_source_type_external_id_key" ON "social_posts"("source_type", "external_id");

-- CreateIndex
CREATE INDEX "social_comments_post_id_idx" ON "social_comments"("post_id");

-- CreateIndex
CREATE INDEX "social_comments_language_idx" ON "social_comments"("language");

-- CreateIndex
CREATE INDEX "social_comments_sentiment_idx" ON "social_comments"("sentiment");

-- CreateIndex
CREATE INDEX "nlp_analyses_collection_job_id_idx" ON "nlp_analyses"("collection_job_id");

-- CreateIndex
CREATE INDEX "prompt_histories_collection_job_id_idx" ON "prompt_histories"("collection_job_id");

-- CreateIndex
CREATE INDEX "prompt_histories_idea_id_idx" ON "prompt_histories"("idea_id");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_collection_job_id_key" ON "ideas"("collection_job_id");

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_jobs" ADD CONSTRAINT "collection_jobs_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nlp_analyses" ADD CONSTRAINT "nlp_analyses_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_histories" ADD CONSTRAINT "prompt_histories_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_histories" ADD CONSTRAINT "prompt_histories_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
