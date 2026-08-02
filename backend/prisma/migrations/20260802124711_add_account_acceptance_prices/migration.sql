-- Add account-specific publication acceptance prices.
ALTER TABLE "system_settings"
ADD COLUMN "normal_acceptance_price" DECIMAL(10,2) NOT NULL DEFAULT 15,
ADD COLUMN "premium_acceptance_price" DECIMAL(10,2) NOT NULL DEFAULT 5;

-- Preserve the previous publication price as the initial normal-user price.
UPDATE "system_settings"
SET "normal_acceptance_price" = COALESCE(
  "published_idea_price",
  15.00
)
WHERE "key" = 'GLOBAL';

-- Ensure valid Premium acceptance pricing.
UPDATE "system_settings"
SET "premium_acceptance_price" = 5.00
WHERE "key" = 'GLOBAL'
  AND "premium_acceptance_price" <= 0;

-- Prevent zero or negative prices.
ALTER TABLE "system_settings"
ADD CONSTRAINT "system_settings_normal_acceptance_price_positive"
CHECK ("normal_acceptance_price" > 0);

ALTER TABLE "system_settings"
ADD CONSTRAINT "system_settings_premium_acceptance_price_positive"
CHECK ("premium_acceptance_price" > 0);