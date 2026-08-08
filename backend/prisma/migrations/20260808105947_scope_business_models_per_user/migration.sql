-- 1) Add user_id as nullable first, because the table already has rows.
ALTER TABLE "idea_business_models"
ADD COLUMN "user_id" TEXT;

-- 2) Backfill existing business models using the owner of the source idea.
UPDATE "idea_business_models" AS bm
SET "user_id" = i."user_id"
FROM "ideas" AS i
WHERE i."id" = bm."idea_id"
  AND bm."user_id" IS NULL;

-- 3) Safety check before making user_id required.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "idea_business_models"
    WHERE "user_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate idea_business_models: some rows have no matching idea owner.';
  END IF;
END $$;

-- 4) Now it is safe to make the column NOT NULL.
ALTER TABLE "idea_business_models"
ALTER COLUMN "user_id" SET NOT NULL;

-- 5) Remove the old indexes that were scoped only by idea.
DROP INDEX IF EXISTS "public"."idea_business_models_idea_id_is_current_idx";
DROP INDEX IF EXISTS "public"."idea_business_models_idea_id_version_key";

-- 6) Create the new indexes scoped by idea + user.
CREATE INDEX "idea_business_models_idea_id_user_id_is_current_idx"
ON "idea_business_models"("idea_id", "user_id", "is_current");

CREATE INDEX "idea_business_models_user_id_created_at_idx"
ON "idea_business_models"("user_id", "created_at");

CREATE UNIQUE INDEX "idea_business_models_idea_id_user_id_version_key"
ON "idea_business_models"("idea_id", "user_id", "version");

-- 7) Add the foreign key relation to users.
ALTER TABLE "idea_business_models"
ADD CONSTRAINT "idea_business_models_user_id_fkey"
FOREIGN KEY ("user_id")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;