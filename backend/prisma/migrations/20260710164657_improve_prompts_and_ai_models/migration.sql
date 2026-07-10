/*
  Warnings:

  - A unique constraint covering the columns `[key]` on the table `system_settings` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "key" TEXT NOT NULL DEFAULT 'GLOBAL';

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

