-- Administrative staff accounts do not belong to a customer subscription tier.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE';

CREATE TABLE "admin_invitations" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "invited_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_invitations_code_hash_key"
ON "admin_invitations"("code_hash");

CREATE INDEX "admin_invitations_email_idx"
ON "admin_invitations"("email");

CREATE INDEX "admin_invitations_expires_at_idx"
ON "admin_invitations"("expires_at");

CREATE INDEX "admin_invitations_accepted_at_idx"
ON "admin_invitations"("accepted_at");

CREATE INDEX "admin_invitations_cancelled_at_idx"
ON "admin_invitations"("cancelled_at");

CREATE INDEX "admin_invitations_invited_by_id_idx"
ON "admin_invitations"("invited_by_id");

ALTER TABLE "admin_invitations"
ADD CONSTRAINT "admin_invitations_invited_by_id_fkey"
FOREIGN KEY ("invited_by_id")
REFERENCES "users"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;