/*
  Warnings:

  - You are about to drop the column `adminReply` on the `contact_messages` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `contact_messages` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `contact_messages` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `contact_messages` table. All the data in the column will be lost.
  - You are about to drop the `FavoriteIdea` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updated_at` to the `contact_messages` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_UPDATE_CONTACT_MESSAGE';
ALTER TYPE "AuditAction" ADD VALUE 'USER_CREATE_CONTACT_MESSAGE';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'CONTACT_MESSAGE';

-- DropForeignKey
ALTER TABLE "public"."FavoriteIdea" DROP CONSTRAINT "FavoriteIdea_ideaId_fkey";

-- DropForeignKey
ALTER TABLE "public"."FavoriteIdea" DROP CONSTRAINT "FavoriteIdea_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."contact_messages" DROP CONSTRAINT "contact_messages_userId_fkey";

-- AlterTable
ALTER TABLE "contact_messages" DROP COLUMN "adminReply",
DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
DROP COLUMN "userId",
ADD COLUMN     "admin_reply" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "average_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ratings_count" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "public"."FavoriteIdea";

-- CreateTable
CREATE TABLE "favorite_ideas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorite_ideas_userId_idx" ON "favorite_ideas"("userId");

-- CreateIndex
CREATE INDEX "favorite_ideas_ideaId_idx" ON "favorite_ideas"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_ideas_userId_ideaId_key" ON "favorite_ideas"("userId", "ideaId");

-- CreateIndex
CREATE INDEX "contact_messages_user_id_idx" ON "contact_messages"("user_id");

-- CreateIndex
CREATE INDEX "contact_messages_email_idx" ON "contact_messages"("email");

-- CreateIndex
CREATE INDEX "contact_messages_status_idx" ON "contact_messages"("status");

-- CreateIndex
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages"("created_at");

-- AddForeignKey
ALTER TABLE "favorite_ideas" ADD CONSTRAINT "favorite_ideas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_ideas" ADD CONSTRAINT "favorite_ideas_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
