-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('STUDENT', 'DEVELOPER', 'COMPANY', 'RESEARCHER', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "user_type" "UserType";
