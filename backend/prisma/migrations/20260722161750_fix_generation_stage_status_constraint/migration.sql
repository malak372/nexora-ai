-- Drop the previous stage-status constraint because it incorrectly
-- required every completed pipeline stage to have 100% progress.
--
-- In Nexora AI, idea_generation_stages.progress_percent represents
-- the overall generation-pipeline progress reached by that stage.
-- For example, request-validation completes at 5%, while finalization
-- completes at 100%.
ALTER TABLE "idea_generation_stages"
DROP CONSTRAINT IF EXISTS "generation_stages_status_consistency_check";

-- Keep stage lifecycle fields consistent without assuming that every
-- completed stage represents completion of the entire pipeline.
ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "generation_stages_status_consistency_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "started_at" IS NULL
    AND "completed_at" IS NULL
    AND "error_message" IS NULL
  )
  OR
  (
    "status" = 'RUNNING'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
    AND "error_message" IS NULL
  )
  OR
  (
    "status" = 'COMPLETED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
    AND "error_message" IS NULL
  )
  OR
  (
    "status" = 'FAILED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
    AND "error_message" IS NOT NULL
  )
  OR
  (
    "status" = 'SKIPPED'
    AND "completed_at" IS NOT NULL
  )
);