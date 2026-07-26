/*
  Warnings:

  - You are about to alter the column `maximum_similarity` on the `idea_generation_candidates` table. The data in that column could be lost. The data in that column will be cast from `Decimal(5,4)` to `Decimal(5,2)`.

*/
-- AlterTable
ALTER TABLE "idea_generation_candidates" ALTER COLUMN "maximum_similarity" SET DATA TYPE DECIMAL(5,2);
