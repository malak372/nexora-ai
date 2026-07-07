/*
  Warnings:

  - The `language` column on the `saved_generation_searches` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "NlpLexiconType" AS ENUM ('PROBLEM', 'NEED', 'POSITIVE', 'NEGATIVE');

-- AlterTable
ALTER TABLE "saved_generation_searches" DROP COLUMN "language",
ADD COLUMN     "language" "LanguageCode";
