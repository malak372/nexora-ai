-- Store the exact start and configured duration of each account lock.
ALTER TABLE "users"
ADD COLUMN "locked_at" TIMESTAMP(3),
ADD COLUMN "lock_duration_minutes" INTEGER;

ALTER TABLE "users"
ADD CONSTRAINT "users_lock_duration_minutes_check"
CHECK (
  "lock_duration_minutes" IS NULL
  OR "lock_duration_minutes" > 0
);