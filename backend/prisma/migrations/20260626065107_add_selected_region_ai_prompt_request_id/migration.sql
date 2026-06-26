-- AlterEnum
ALTER TYPE "GeneratedOutputType" ADD VALUE 'AI_PROMPT';

-- AlterTable
ALTER TABLE "external_api_logs" ADD COLUMN     "request_id" TEXT;

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "selected_region" TEXT;
