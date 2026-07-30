-- Allow a successfully evaluated generation run to complete without an idea
-- only when the persisted context explicitly records that no recurring
-- opportunity reached the required independent-evidence threshold.
--
-- This preserves the original invariant for ordinary successful runs:
-- COMPLETED still requires idea_id unless the outcome is the audited
-- NO_RECURRING_OPPORTUNITY terminal result.

ALTER TABLE "idea_generation_runs"
DROP CONSTRAINT IF EXISTS "generation_runs_status_consistency_check";

ALTER TABLE "idea_generation_runs"
ADD CONSTRAINT "generation_runs_status_consistency_check"
CHECK (
  (
    "status" = 'QUEUED'
    AND "started_at" IS NULL
    AND "completed_at" IS NULL
    AND "next_retry_at" IS NULL
    AND "paused_at" IS NULL
  )
  OR
  (
    "status" = 'RUNNING'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
    AND "paused_at" IS NULL
  )
  OR
  (
    "status" = 'RETRYING'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
    AND "next_retry_at" IS NOT NULL
    AND "paused_at" IS NULL
  )
  OR
  (
    "status" = 'PAUSED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NULL
    AND "next_retry_at" IS NOT NULL
    AND "paused_at" IS NOT NULL
  )
  OR
  (
    "status" = 'COMPLETED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
    AND "progress_percent" = 100
    AND (
      "idea_id" IS NOT NULL
      OR "context_snapshot" #>> '{noResultOutcome,code}' =
        'NO_RECURRING_OPPORTUNITY'
    )
  )
  OR
  (
    "status" = 'FAILED'
    AND "started_at" IS NOT NULL
    AND "completed_at" IS NOT NULL
  )
  OR
  (
    "status" = 'CANCELLED'
    AND "completed_at" IS NOT NULL
  )
);