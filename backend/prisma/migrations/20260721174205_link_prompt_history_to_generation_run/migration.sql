-- AlterTable
ALTER TABLE "prompt_histories" ADD COLUMN     "generation_run_id" TEXT;

-- CreateIndex
CREATE INDEX "prompt_histories_generation_run_id_idx" ON "prompt_histories"("generation_run_id");

-- AddForeignKey
ALTER TABLE "prompt_histories" ADD CONSTRAINT "prompt_histories_generation_run_id_fkey" FOREIGN KEY ("generation_run_id") REFERENCES "idea_generation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
