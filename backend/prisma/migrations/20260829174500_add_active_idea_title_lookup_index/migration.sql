-- Speed the final race-safe duplicate-title lookup performed while persisting
-- a generated idea. The query is case-insensitive and ignores soft-deleted
-- rows, so a matching partial expression index avoids scanning the full ideas
-- table while the user is waiting for generation completion.
CREATE INDEX IF NOT EXISTS "ideas_active_lower_title_idx"
ON "ideas" (lower("title"))
WHERE "deleted_at" IS NULL;
