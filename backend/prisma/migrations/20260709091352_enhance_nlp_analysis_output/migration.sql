/*
  Warnings:

  - You are about to drop the `NlpAnalysis` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."NlpAnalysis" DROP CONSTRAINT "NlpAnalysis_collection_job_id_fkey";

-- DropTable
DROP TABLE "public"."NlpAnalysis";

-- CreateTable
CREATE TABLE "nlp_analyses" (
    "id" TEXT NOT NULL,
    "collection_job_id" TEXT NOT NULL,
    "total_texts_analyzed" INTEGER NOT NULL DEFAULT 0,
    "sentiment_stats" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "topics" JSONB,
    "recurring_problems" JSONB NOT NULL,
    "extracted_needs" JSONB,
    "feature_requests" JSONB,
    "opportunities" JSONB,
    "insights" JSONB,
    "data_quality" JSONB,
    "evidence_samples" JSONB,
    "statistics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nlp_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nlp_analyses_collection_job_id_key" ON "nlp_analyses"("collection_job_id");

-- AddForeignKey
ALTER TABLE "nlp_analyses" ADD CONSTRAINT "nlp_analyses_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "collection_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
