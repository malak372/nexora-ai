/*
  Warnings:

  - A unique constraint covering the columns `[run_id,provider_key,api_model_id,opportunity_rank]` on the table `idea_generation_candidates` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."idea_generation_candidates_run_id_provider_key_api_model_id_key";

-- AlterTable
ALTER TABLE "idea_generation_candidates" ADD COLUMN     "opportunity_rank" INTEGER,
ADD COLUMN     "opportunity_title" TEXT;

-- CreateIndex
CREATE INDEX "idea_generation_candidates_run_id_opportunity_rank_idx" ON "idea_generation_candidates"("run_id", "opportunity_rank");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_opportunity_title_idx" ON "idea_generation_candidates"("opportunity_title");

-- CreateIndex
CREATE UNIQUE INDEX "idea_generation_candidates_run_model_opportunity_key" ON "idea_generation_candidates"("run_id", "provider_key", "api_model_id", "opportunity_rank");
