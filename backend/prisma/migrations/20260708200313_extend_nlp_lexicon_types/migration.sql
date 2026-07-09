-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NlpLexiconType" ADD VALUE 'FEATURE_REQUEST';
ALTER TYPE "NlpLexiconType" ADD VALUE 'COMPLAINT';
ALTER TYPE "NlpLexiconType" ADD VALUE 'URGENCY';
ALTER TYPE "NlpLexiconType" ADD VALUE 'COST';
ALTER TYPE "NlpLexiconType" ADD VALUE 'TIME';
ALTER TYPE "NlpLexiconType" ADD VALUE 'ACCESSIBILITY';
ALTER TYPE "NlpLexiconType" ADD VALUE 'SAFETY';
ALTER TYPE "NlpLexiconType" ADD VALUE 'RELIABILITY';
