/*
  Warnings:

  - You are about to drop the `nlp_analyses` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."nlp_analyses" DROP CONSTRAINT "nlp_analyses_collection_job_id_fkey";

-- DropTable
DROP TABLE "public"."nlp_analyses";

-- CreateTable
CREATE TABLE "NlpAnalysis" (
    "id" TEXT NOT NULL,
    "collection_job_id" TEXT NOT NULL,
    "total_texts_analyzed" INTEGER NOT NULL DEFAULT 0,
    "sentiment_stats" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "topics" JSONB,
    "recurring_problems" JSONB NOT NULL,
    "extracted_needs" JSONB,
    "sample_comments" JSONB,
    "statistics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NlpAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NlpAnalysis_collection_job_id_key" ON "NlpAnalysis"("collection_job_id");

-- AddForeignKey
ALTER TABLE "NlpAnalysis" ADD CONSTRAINT "NlpAnalysis_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
