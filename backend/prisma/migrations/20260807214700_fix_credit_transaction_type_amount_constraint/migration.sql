ALTER TABLE "credit_transactions"
DROP CONSTRAINT IF EXISTS "credit_transactions_type_amount_check";

ALTER TABLE "credit_transactions"
ADD CONSTRAINT "credit_transactions_type_amount_check"
CHECK (
  (
    "type" IN (
      'PURCHASE',
      'BONUS',
      'REFUND'
    )
    AND "amount" > 0
  )
  OR
  (
    "type" = 'DEDUCTION_GENERATION'
    AND "amount" < 0
    AND "idea_id" IS NOT NULL
  )
  OR
  (
    "type" = 'DEDUCTION_PUBLICATION_ADVANCED'
    AND "amount" < 0
    AND "publication_acceptance_id" IS NOT NULL
  )
  OR
  (
    "type" = 'ADMIN_ADJUSTMENT'
    AND "amount" <> 0
  )
);