/*
  Warnings:

  - You are about to drop the column `evidence_samples` on the `nlp_analyses` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "nlp_analyses" DROP COLUMN "evidence_samples",
ADD COLUMN     "sample_comments" JSONB,
ADD COLUMN     "sample_posts" JSONB;
