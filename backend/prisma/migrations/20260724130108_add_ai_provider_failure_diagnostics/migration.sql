-- AlterTable
ALTER TABLE "external_api_logs" ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "is_retryable" BOOLEAN;

-- CreateIndex
CREATE INDEX "external_api_logs_operation_id_attempt_number_idx" ON "external_api_logs"("operation_id", "attempt_number");

-- CreateIndex
CREATE INDEX "external_api_logs_error_code_created_at_idx" ON "external_api_logs"("error_code", "created_at");

-- CreateIndex
CREATE INDEX "external_api_logs_is_retryable_created_at_idx" ON "external_api_logs"("is_retryable", "created_at");
