-- Persist the hybrid score used to select the winning AI candidate.
ALTER TABLE "idea_generation_candidates"
ADD COLUMN "final_score" DECIMAL(5, 2);

-- Backfill historical candidates.
--
-- When an AI judge score exists, use:
-- 70% AI judge + 30% deterministic quality.
--
-- When the judge score is unavailable, preserve overall_score.
UPDATE "idea_generation_candidates"
SET "final_score" = ROUND(
  CASE
    WHEN "ai_judge_score" IS NOT NULL
      AND "overall_score" IS NOT NULL
    THEN
      ("ai_judge_score" * 0.70)
      + ("overall_score" * 0.30)
    ELSE "overall_score"
  END,
  2
)
WHERE "final_score" IS NULL
  AND "overall_score" IS NOT NULL;

-- Keep final scores inside the valid 0–100 range.
ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_final_score_check"
CHECK (
  "final_score" IS NULL
  OR (
    "final_score" >= 0
    AND "final_score" <= 100
  )
);

CREATE INDEX "idea_generation_candidates_final_score_idx"
ON "idea_generation_candidates"("final_score");