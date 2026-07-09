-- AlterTable
ALTER TABLE "nlp_analyses" ADD COLUMN     "ai_used" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "confidence" DECIMAL(4,3);

-- CreateIndex
CREATE INDEX "nlp_lexicons_type_language_idx" ON "nlp_lexicons"("type", "language");
