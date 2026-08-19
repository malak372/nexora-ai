ALTER TABLE "domains"
ADD COLUMN "is_visible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "is_auto_generated" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "domains_is_active_is_visible_idx"
ON "domains"("is_active", "is_visible");

CREATE INDEX "domains_is_auto_generated_is_visible_idx"
ON "domains"("is_auto_generated", "is_visible");
