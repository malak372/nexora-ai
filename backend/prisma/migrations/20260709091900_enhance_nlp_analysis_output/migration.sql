/*
  Warnings:

  - You are about to drop the column `statistics` on the `nlp_analyses` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "nlp_analyses" DROP COLUMN "statistics",
ADD COLUMN     "total_comments_analyzed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_posts_analyzed" INTEGER NOT NULL DEFAULT 0;
