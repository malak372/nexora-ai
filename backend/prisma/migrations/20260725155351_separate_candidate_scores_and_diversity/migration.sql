-- AlterTable
ALTER TABLE "idea_generation_candidates" ADD COLUMN     "hybrid_final_score" DECIMAL(5,2),
ADD COLUMN     "maximum_similarity" DECIMAL(5,4),
ADD COLUMN     "most_similar_candidate_id" TEXT,
ADD COLUMN     "semantic_diversity_adjusted_score" DECIMAL(5,2),
ADD COLUMN     "semantic_diversity_score" DECIMAL(5,2),
ADD COLUMN     "semantic_duplicate_risk" TEXT;

-- CreateIndex
CREATE INDEX "idea_generation_candidates_semantic_diversity_adjusted_scor_idx" ON "idea_generation_candidates"("semantic_diversity_adjusted_score");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_hybrid_final_score_idx" ON "idea_generation_candidates"("hybrid_final_score");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_semantic_diversity_score_idx" ON "idea_generation_candidates"("semantic_diversity_score");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_maximum_similarity_idx" ON "idea_generation_candidates"("maximum_similarity");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_most_similar_candidate_id_idx" ON "idea_generation_candidates"("most_similar_candidate_id");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_semantic_duplicate_risk_idx" ON "idea_generation_candidates"("semantic_duplicate_risk");
