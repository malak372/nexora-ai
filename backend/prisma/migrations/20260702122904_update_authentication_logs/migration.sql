-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuthAction" ADD VALUE 'ACCOUNT_DEACTIVATED';
ALTER TYPE "AuthAction" ADD VALUE 'EMAIL_CHANGED';

-- AlterTable
ALTER TABLE "authentication_logs" ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "user_agent" TEXT;
