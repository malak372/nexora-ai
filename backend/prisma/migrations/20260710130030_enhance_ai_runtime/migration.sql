-- CreateEnum
CREATE TYPE "AiModelHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AiRoutingStrategy" AS ENUM ('DEFAULT', 'LOWEST_COST', 'BALANCED');

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "health_status" "AiModelHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "input_cost_per_million" DECIMAL(12,6) NOT NULL DEFAULT 0,
ADD COLUMN     "last_failure_at" TIMESTAMP(3),
ADD COLUMN     "last_health_check_at" TIMESTAMP(3),
ADD COLUMN     "max_output_tokens" INTEGER NOT NULL DEFAULT 2048,
ADD COLUMN     "output_cost_per_million" DECIMAL(12,6) NOT NULL DEFAULT 0,
ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "external_api_logs" ADD COLUMN     "attempt_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "fallback_used" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "operation_id" TEXT,
ALTER COLUMN "cost_estimate" SET DATA TYPE DECIMAL(12,6);

-- CreateIndex
CREATE INDEX "ai_models_is_active_health_status_idx" ON "ai_models"("is_active", "health_status");

-- CreateIndex
CREATE INDEX "external_api_logs_operation_id_idx" ON "external_api_logs"("operation_id");
