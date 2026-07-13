/*
  Warnings:

  - A unique constraint covering the columns `[fingerprint_hash]` on the table `guest_sessions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `fingerprint_hash` to the `guest_sessions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "guest_sessions" ADD COLUMN     "fingerprint_hash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "idea_generation_locks" (
    "id" TEXT NOT NULL,
    "lock_key" TEXT NOT NULL,
    "owner_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_generation_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idea_generation_locks_lock_key_key" ON "idea_generation_locks"("lock_key");

-- CreateIndex
CREATE INDEX "idea_generation_locks_expires_at_idx" ON "idea_generation_locks"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "guest_sessions_fingerprint_hash_key" ON "guest_sessions"("fingerprint_hash");

-- CreateIndex
CREATE INDEX "guest_sessions_expires_at_idx" ON "guest_sessions"("expires_at");
