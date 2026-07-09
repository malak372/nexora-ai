-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'USER_AI_CHAT';
ALTER TYPE "AuditAction" ADD VALUE 'ABSTRACT_GENERATION_RUN';
ALTER TYPE "AuditAction" ADD VALUE 'PROMPT_HISTORY_CREATED';

-- AlterEnum
ALTER TYPE "NlpLexiconType" ADD VALUE 'OPPORTUNITY';
