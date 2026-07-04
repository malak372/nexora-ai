/*
  Warnings:

  - A unique constraint covering the columns `[domain_id,keyword,language]` on the table `domain_keywords` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "LanguageCode" AS ENUM ('ANY', 'EN', 'AR', 'FR', 'ES', 'DE');

-- DropIndex
DROP INDEX "public"."domain_keywords_domain_id_keyword_key";

-- AlterTable
ALTER TABLE "domain_keywords" ADD COLUMN     "language" "LanguageCode" NOT NULL DEFAULT 'ANY';

-- CreateIndex
CREATE UNIQUE INDEX "domain_keywords_domain_id_keyword_language_key" ON "domain_keywords"("domain_id", "keyword", "language");
