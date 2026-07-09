-- AlterTable
ALTER TABLE "prompt_histories" ADD COLUMN     "estimated_input_tokens" INTEGER,
ADD COLUMN     "template_hash" TEXT;

-- CreateIndex
CREATE INDEX "prompt_histories_prompt_type_idx" ON "prompt_histories"("prompt_type");

-- CreateIndex
CREATE INDEX "prompt_histories_created_at_idx" ON "prompt_histories"("created_at");
