-- Add the administrator-selected base currency for all configurable prices.
ALTER TABLE "system_settings"
ADD COLUMN "pricing_currency" VARCHAR(3) NOT NULL DEFAULT 'USD';

ALTER TABLE "system_settings"
ADD CONSTRAINT "system_settings_pricing_currency_check"
CHECK ("pricing_currency" IN ('USD', 'EUR', 'GBP', 'ILS', 'AED'));