/*
 * Normalize historical provider keys so they match the stable
 * lowercase keys used by the backend provider registry.
 */
UPDATE "ai_models"
SET "provider_key" = LOWER(TRIM("provider_key"));