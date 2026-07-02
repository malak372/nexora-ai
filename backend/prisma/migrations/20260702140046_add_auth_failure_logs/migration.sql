-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthAction" ADD VALUE 'VERIFICATION_EMAIL_SENT';
ALTER TYPE "AuthAction" ADD VALUE 'VERIFY_EMAIL_FAILED';
ALTER TYPE "AuthAction" ADD VALUE 'RESET_PASSWORD_FAILED';
ALTER TYPE "AuthAction" ADD VALUE 'REFRESH_TOKEN_FAILED';
