/*
  Warnings:

  - The `objectives` column on the `ideas` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `target_users` column on the `ideas` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "ideas" DROP COLUMN "objectives",
ADD COLUMN     "objectives" JSONB,
DROP COLUMN "target_users",
ADD COLUMN     "target_users" JSONB;
