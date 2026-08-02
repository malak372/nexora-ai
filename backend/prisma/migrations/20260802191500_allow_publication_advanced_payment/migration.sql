-- Allow all supported payment purposes while preserving purpose-specific integrity.
ALTER TABLE "payments"
DROP CONSTRAINT IF EXISTS "payments_purpose_consistency_check";

ALTER TABLE "payments"
ADD CONSTRAINT "payments_purpose_consistency_check"
CHECK (
  (
    "payment_purpose" = 'BUY_CREDITS'
    AND "idea_id" IS NULL
    AND "publication_id" IS NULL
    AND "credits_amount" > 0
  )
  OR
  (
    "payment_purpose" = 'DIRECT_UNLOCK'
    AND "idea_id" IS NOT NULL
    AND "publication_id" IS NULL
    AND "credits_amount" = 0
    AND "bonus_credits_amount" = 0
  )
  OR
  (
    "payment_purpose" = 'ACCEPT_PUBLICATION'
    AND "idea_id" IS NULL
    AND "publication_id" IS NOT NULL
    AND "credits_amount" = 0
    AND "bonus_credits_amount" = 0
    AND "activates_premium" = FALSE
  )
  OR
  (
    "payment_purpose" = 'UNLOCK_PUBLICATION_ADVANCED'
    AND "idea_id" IS NULL
    AND "publication_id" IS NOT NULL
    AND "credits_amount" = 0
    AND "bonus_credits_amount" = 0
    AND "activates_premium" = FALSE
  )
);
