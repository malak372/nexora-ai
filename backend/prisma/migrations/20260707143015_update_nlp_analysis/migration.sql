-- CreateTable
CREATE TABLE "PositiveWord" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "language" "LanguageCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositiveWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegativeWord" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "language" "LanguageCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegativeWord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PositiveWord_word_language_key" ON "PositiveWord"("word", "language");

-- CreateIndex
CREATE UNIQUE INDEX "NegativeWord_word_language_key" ON "NegativeWord"("word", "language");
