/*
  Warnings:

  - You are about to drop the column `idea_advanced_credit_cost` on the `system_settings` table. All the data in the column will be lost.
  - You are about to drop the column `premium_idea_credit_cost` on the `system_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "system_settings" DROP COLUMN "idea_advanced_credit_cost",
DROP COLUMN "premium_idea_credit_cost",
ALTER COLUMN "credit_price" DROP DEFAULT,
ALTER COLUMN "premium_activation_fee" SET DEFAULT 5;
