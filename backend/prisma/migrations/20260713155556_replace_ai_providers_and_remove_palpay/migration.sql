/*
  Warnings:

  - The values [OPENAI,ANTHROPIC] on the enum `AiProviderType` will be removed. If these variants are still used in the database, this will fail.
  - The values [OPENAI,PALPAY,ANTHROPIC] on the enum `ApiProvider` will be removed. If these variants are still used in the database, this will fail.
  - The values [PALPAY] on the enum `PaymentProvider` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AiProviderType_new" AS ENUM ('GOOGLE', 'GROQ', 'OPENROUTER');
ALTER TABLE "public"."ai_models" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "ai_models" ALTER COLUMN "provider" TYPE "AiProviderType_new" USING ("provider"::text::"AiProviderType_new");
ALTER TYPE "AiProviderType" RENAME TO "AiProviderType_old";
ALTER TYPE "AiProviderType_new" RENAME TO "AiProviderType";
DROP TYPE "public"."AiProviderType_old";
ALTER TABLE "ai_models" ALTER COLUMN "provider" SET DEFAULT 'OPENROUTER';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ApiProvider_new" AS ENUM ('GOOGLE', 'GROQ', 'OPENROUTER', 'STRIPE', 'PAYPAL', 'REDDIT', 'FACEBOOK', 'YOUTUBE', 'LINKEDIN', 'X', 'INSTAGRAM', 'TELEGRAM', 'TIKTOK', 'GITHUB', 'STACKOVERFLOW', 'DISCORD', 'QUORA', 'FORUM', 'BLOG', 'NEWS', 'HACKER_NEWS', 'PRODUCT_HUNT', 'DEV_TO', 'GOOGLE_PLAY', 'APP_STORE', 'GOOGLE_MAPS', 'OTHER');
ALTER TABLE "external_api_logs" ALTER COLUMN "provider" TYPE "ApiProvider_new" USING ("provider"::text::"ApiProvider_new");
ALTER TYPE "ApiProvider" RENAME TO "ApiProvider_old";
ALTER TYPE "ApiProvider_new" RENAME TO "ApiProvider";
DROP TYPE "public"."ApiProvider_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentProvider_new" AS ENUM ('STRIPE', 'PAYPAL');
ALTER TABLE "payments" ALTER COLUMN "provider" TYPE "PaymentProvider_new" USING ("provider"::text::"PaymentProvider_new");
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
ALTER TYPE "PaymentProvider_new" RENAME TO "PaymentProvider";
DROP TYPE "public"."PaymentProvider_old";
COMMIT;

-- AlterTable
ALTER TABLE "ai_models" ALTER COLUMN "provider" SET DEFAULT 'OPENROUTER';
