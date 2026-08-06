-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "idea_advanced_credit_cost" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "premium_idea_credit_cost" INTEGER NOT NULL DEFAULT 15,
ALTER COLUMN "credit_price" SET DEFAULT 1,
ALTER COLUMN "premium_activation_fee" SET DEFAULT 0;
