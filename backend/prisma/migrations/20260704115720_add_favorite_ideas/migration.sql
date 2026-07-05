-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_UPDATE_PROFILE';
ALTER TYPE "AuditAction" ADD VALUE 'USER_MARK_NOTIFICATION_READ';
ALTER TYPE "AuditAction" ADD VALUE 'USER_MARK_ALL_NOTIFICATIONS_READ';

-- CreateTable
CREATE TABLE "FavoriteIdea" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteIdea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteIdea_userId_ideaId_key" ON "FavoriteIdea"("userId", "ideaId");

-- AddForeignKey
ALTER TABLE "FavoriteIdea" ADD CONSTRAINT "FavoriteIdea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteIdea" ADD CONSTRAINT "FavoriteIdea_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
