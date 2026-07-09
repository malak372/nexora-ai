-- CreateTable
CREATE TABLE "nlp_lexicons" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "type" "NlpLexiconType" NOT NULL,
    "language" "LanguageCode" NOT NULL DEFAULT 'ANY',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nlp_lexicons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nlp_lexicons_type_idx" ON "nlp_lexicons"("type");

-- CreateIndex
CREATE INDEX "nlp_lexicons_language_idx" ON "nlp_lexicons"("language");

-- CreateIndex
CREATE INDEX "nlp_lexicons_is_active_idx" ON "nlp_lexicons"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "nlp_lexicons_word_type_language_key" ON "nlp_lexicons"("word", "type", "language");
