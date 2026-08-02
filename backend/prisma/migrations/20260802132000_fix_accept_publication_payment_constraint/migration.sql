-- Allow publication-acceptance payments while preserving purpose-specific integrity.
--
-- The original constraint was created before ACCEPT_PUBLICATION existed and
-- therefore rejected every valid publication checkout with PostgreSQL 23514.
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
);