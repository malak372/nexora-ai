/*
  Warnings:

  - You are about to drop the column `final_score` on the `idea_generation_candidates` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."idea_generation_candidates_final_score_idx";

-- AlterTable
ALTER TABLE "idea_generation_candidates" DROP COLUMN "final_score",
ADD COLUMN     "ai_judge_innovation_score" DECIMAL(5,2);

-- CreateIndex
CREATE INDEX "idea_generation_candidates_ai_judge_score_idx" ON "idea_generation_candidates"("ai_judge_score");
