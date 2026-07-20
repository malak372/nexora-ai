-- Ensure that at most one AI model can be selected as the global default.
-- The partial index permits any number of non-default models while protecting
-- the dedicated set-default transaction from cross-instance race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_single_default_idx"
ON "ai_models" ("is_default")
WHERE "is_default" = TRUE;

-- Keep progress values valid even when generation state is updated by workers
-- or administrative recovery operations.
ALTER TABLE "idea_generation_runs"
ADD CONSTRAINT "idea_generation_runs_progress_check"
CHECK ("progress_percent" BETWEEN 0 AND 100);

ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "idea_generation_stages_progress_check"
CHECK ("progress_percent" BETWEEN 0 AND 100);