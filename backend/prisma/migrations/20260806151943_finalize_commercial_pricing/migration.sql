/*
  Warnings:

  - You are about to drop the column `premium_acceptance_price` on the `system_settings` table. All the data in the column will be lost.
  - You are about to drop the column `published_idea_price` on the `system_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "system_settings" DROP COLUMN "premium_acceptance_price",
DROP COLUMN "published_idea_price",
ALTER COLUMN "direct_unlock_price" SET DEFAULT 15,
ALTER COLUMN "publication_advanced_credit_cost" SET DEFAULT 10,
ALTER COLUMN "normal_acceptance_price" SET DEFAULT 5,
ALTER COLUMN "normal_publication_advanced_price" SET DEFAULT 10;
