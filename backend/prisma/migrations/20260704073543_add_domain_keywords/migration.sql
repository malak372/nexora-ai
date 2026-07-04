/*
  Warnings:

  - Made the column `external_id` on table `social_comments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `external_id` on table `social_posts` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "social_comments" ALTER COLUMN "external_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "social_posts" ALTER COLUMN "external_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "domain_keywords" (
    "id" TEXT NOT NULL,
    "domain_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_keywords_domain_id_idx" ON "domain_keywords"("domain_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_keywords_domain_id_keyword_key" ON "domain_keywords"("domain_id", "keyword");

-- AddForeignKey
ALTER TABLE "domain_keywords" ADD CONSTRAINT "domain_keywords_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
