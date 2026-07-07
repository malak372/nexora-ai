/*
  Warnings:

  - A unique constraint covering the columns `[collection_job_id]` on the table `nlp_analyses` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `nlp_analyses` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."nlp_analyses_collection_job_id_idx";

-- AlterTable
ALTER TABLE "nlp_analyses" ADD COLUMN     "total_texts_analyzed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "nlp_analyses_collection_job_id_key" ON "nlp_analyses"("collection_job_id");
