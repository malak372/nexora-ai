-- Allow infrastructure-recovery lifecycle states in the run consistency rule.
--
-- The original constraint was created before RETRYING and PAUSED were added to
-- IdeaGenerationRunStatus. PostgreSQL therefore rejected valid recovery updates
-- with error 23514. This migration replaces the obsolete constraint safely.

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
    AND "idea_id" IS NOT NULL
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