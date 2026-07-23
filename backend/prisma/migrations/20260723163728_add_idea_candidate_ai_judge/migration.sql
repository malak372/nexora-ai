-- AlterEnum
ALTER TYPE "PromptType" ADD VALUE 'IDEA_EVALUATION';

-- AlterTable
ALTER TABLE "idea_generation_candidates" ADD COLUMN     "ai_judge_score" DECIMAL(5,2),
ADD COLUMN     "final_score" DECIMAL(5,2),
ADD COLUMN     "implementation_clarity_score" DECIMAL(5,2),
ADD COLUMN     "judge_confidence" DECIMAL(5,2),
ADD COLUMN     "judge_reason" TEXT,
ADD COLUMN     "judge_risks" JSONB,
ADD COLUMN     "judge_strengths" JSONB,
ADD COLUMN     "local_relevance_score" DECIMAL(5,2),
ADD COLUMN     "market_potential_score" DECIMAL(5,2),
ADD COLUMN     "problem_importance_score" DECIMAL(5,2),
ADD COLUMN     "regulatory_feasibility_score" DECIMAL(5,2),
ADD COLUMN     "requires_legal_verification" BOOLEAN,
ADD COLUMN     "technical_feasibility_score" DECIMAL(5,2);

-- CreateIndex
CREATE INDEX "idea_generation_candidates_final_score_idx" ON "idea_generation_candidates"("final_score");


-- Keep all persisted AI-judge scores inside the supported 0–100 range.
ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_ai_judge_score_check"
CHECK (
  "ai_judge_score" IS NULL
  OR "ai_judge_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_final_score_check"
CHECK (
  "final_score" IS NULL
  OR "final_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_local_relevance_score_check"
CHECK (
  "local_relevance_score" IS NULL
  OR "local_relevance_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_problem_importance_score_check"
CHECK (
  "problem_importance_score" IS NULL
  OR "problem_importance_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_regulatory_feasibility_score_check"
CHECK (
  "regulatory_feasibility_score" IS NULL
  OR "regulatory_feasibility_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_technical_feasibility_score_check"
CHECK (
  "technical_feasibility_score" IS NULL
  OR "technical_feasibility_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_market_potential_score_check"
CHECK (
  "market_potential_score" IS NULL
  OR "market_potential_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_implementation_clarity_score_check"
CHECK (
  "implementation_clarity_score" IS NULL
  OR "implementation_clarity_score" BETWEEN 0 AND 100
),
ADD CONSTRAINT "idea_generation_candidates_judge_confidence_check"
CHECK (
  "judge_confidence" IS NULL
  OR "judge_confidence" BETWEEN 0 AND 100
);