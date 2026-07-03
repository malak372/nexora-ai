/*
  Warnings:

  - You are about to drop the column `ipAddress` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `lastUsedAt` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `emailVerifiedAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `lastLoginAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `passwordChangedAt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `user_type` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[post_id,external_id]` on the table `social_comments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApiProvider" ADD VALUE 'YOUTUBE';
ALTER TYPE "ApiProvider" ADD VALUE 'LINKEDIN';
ALTER TYPE "ApiProvider" ADD VALUE 'X';
ALTER TYPE "ApiProvider" ADD VALUE 'INSTAGRAM';
ALTER TYPE "ApiProvider" ADD VALUE 'TELEGRAM';
ALTER TYPE "ApiProvider" ADD VALUE 'TIKTOK';
ALTER TYPE "ApiProvider" ADD VALUE 'GITHUB';
ALTER TYPE "ApiProvider" ADD VALUE 'STACKOVERFLOW';
ALTER TYPE "ApiProvider" ADD VALUE 'DISCORD';
ALTER TYPE "ApiProvider" ADD VALUE 'QUORA';
ALTER TYPE "ApiProvider" ADD VALUE 'GOOGLE_PLAY';
ALTER TYPE "ApiProvider" ADD VALUE 'APP_STORE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CollectionSourceType" ADD VALUE 'X';
ALTER TYPE "CollectionSourceType" ADD VALUE 'INSTAGRAM';
ALTER TYPE "CollectionSourceType" ADD VALUE 'TELEGRAM';
ALTER TYPE "CollectionSourceType" ADD VALUE 'TIKTOK';
ALTER TYPE "CollectionSourceType" ADD VALUE 'GITHUB';
ALTER TYPE "CollectionSourceType" ADD VALUE 'STACKOVERFLOW';
ALTER TYPE "CollectionSourceType" ADD VALUE 'DISCORD';
ALTER TYPE "CollectionSourceType" ADD VALUE 'QUORA';
ALTER TYPE "CollectionSourceType" ADD VALUE 'BLOG';
ALTER TYPE "CollectionSourceType" ADD VALUE 'NEWS';
ALTER TYPE "CollectionSourceType" ADD VALUE 'APP_STORE';
ALTER TYPE "CollectionSourceType" ADD VALUE 'GOOGLE_PLAY';

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "ipAddress",
DROP COLUMN "lastUsedAt",
DROP COLUMN "userAgent",
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "last_used_at" TIMESTAMP(3),
ADD COLUMN     "user_agent" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "emailVerifiedAt",
DROP COLUMN "lastLoginAt",
DROP COLUMN "passwordChangedAt",
DROP COLUMN "user_type",
ADD COLUMN     "email_verified_at" TIMESTAMP(3),
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "password_changed_at" TIMESTAMP(3),
ADD COLUMN     "userType" "UserType";

-- CreateIndex
CREATE UNIQUE INDEX "social_comments_post_id_external_id_key" ON "social_comments"("post_id", "external_id");
