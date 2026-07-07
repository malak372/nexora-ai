/*
  Warnings:

  - The values [MOCK] on the enum `CollectionSourceType` will be removed.
  - Existing NULL values are normalized before required columns are enforced.
  - Duplicate social posts are removed before adding the new unique constraint.
*/

-- Normalize existing data before schema changes
UPDATE "social_posts"
SET "source_type" = 'OTHER'
WHERE "source_type" = 'MOCK';

UPDATE "collection_jobs"
SET "country" = 'ANY'
WHERE "country" IS NULL;

UPDATE "collection_jobs"
SET "language" = 'ANY'
WHERE "language" IS NULL;

UPDATE "social_posts"
SET "country" = 'ANY'
WHERE "country" IS NULL;

-- AlterEnum
BEGIN;
CREATE TYPE "CollectionSourceType_new" AS ENUM ('REDDIT', 'FACEBOOK', 'YOUTUBE', 'LINKEDIN', 'X', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'GITHUB', 'STACKOVERFLOW', 'DISCORD', 'QUORA', 'FORUM', 'BLOG', 'NEWS', 'APP_STORE', 'GOOGLE_PLAY', 'HACKER_NEWS', 'PRODUCT_HUNT', 'DEV_TO', 'OTHER');
ALTER TABLE "social_posts" ALTER COLUMN "source_type" TYPE "CollectionSourceType_new" USING ("source_type"::text::"CollectionSourceType_new");
ALTER TYPE "CollectionSourceType" RENAME TO "CollectionSourceType_old";
ALTER TYPE "CollectionSourceType_new" RENAME TO "CollectionSourceType";
DROP TYPE "public"."CollectionSourceType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "LanguageCode" ADD VALUE 'TR';

-- AlterEnum
ALTER TYPE "PromptType" ADD VALUE 'IDEA_UNLOCK';

-- DropIndex
DROP INDEX "public"."social_posts_source_type_external_id_key";

-- AlterTable
ALTER TABLE "collection_jobs"
ALTER COLUMN "country" SET NOT NULL,
ALTER COLUMN "language" SET NOT NULL;

-- AlterTable
ALTER TABLE "social_comments"
DROP COLUMN "language",
ADD COLUMN "language" "LanguageCode";

-- AlterTable
ALTER TABLE "social_posts"
ALTER COLUMN "country" SET NOT NULL,
DROP COLUMN "language",
ADD COLUMN "language" "LanguageCode";

-- Remove duplicate posts before adding the new unique constraint
DELETE FROM "social_posts" a
USING "social_posts" b
WHERE a."id" > b."id"
  AND a."collection_job_id" = b."collection_job_id"
  AND a."source_type" = b."source_type"
  AND a."external_id" = b."external_id";

-- CreateIndex
CREATE INDEX "collection_jobs_country_idx" ON "collection_jobs"("country");

-- CreateIndex
CREATE INDEX "social_comments_language_idx" ON "social_comments"("language");

-- CreateIndex
CREATE INDEX "social_posts_country_idx" ON "social_posts"("country");

-- CreateIndex
CREATE INDEX "social_posts_language_idx" ON "social_posts"("language");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_collection_job_id_source_type_external_id_key"
ON "social_posts"("collection_job_id", "source_type", "external_id");

-- CreateIndex
CREATE INDEX "users_locked_until_idx" ON "users"("locked_until");

-- CreateIndex
CREATE INDEX "users_login_lock_level_idx" ON "users"("login_lock_level");