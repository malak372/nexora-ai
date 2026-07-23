
-- CollectionJobService now writes created_at and started_at using the same
-- application timestamp. The existing collection_jobs_dates_check constraint
-- can therefore remain unchanged.

-- Allow retryable generation stages to return to PENDING while retaining the
-- safe error message from the previous failed attempt.
--
-- Lifecycle expectations:
-- - PENDING: not executing; timestamps are null. A retry diagnostic may exist.
-- - RUNNING: started, not completed, and no current error.
-- - COMPLETED: started and completed successfully.
-- - FAILED: started and completed with an error.
-- - SKIPPED: completed without requiring a start timestamp.
ALTER TABLE "idea_generation_stages"
DROP CONSTRAINT IF EXISTS "generation_stages_status_consistency_check";

ALTER TABLE "idea_generation_stages"
ADD CONSTRAINT "generation_stages_status_consistency_check"
CHECK (
  (
    "status" = 'PENDING'
    AND "started_at" IS NULL
    AND "completed_at" IS NULL
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