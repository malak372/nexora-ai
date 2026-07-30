/*
  Warnings:

  - A unique constraint covering the columns `[user_id,client_request_id]` on the table `idea_publication_acceptances` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `client_request_id` to the `idea_publication_acceptances` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "IdeaAdoptionMode" AS ENUM ('NON_EXCLUSIVE', 'LIMITED', 'EXCLUSIVE');

-- AlterTable
ALTER TABLE "idea_publication_acceptances" ADD COLUMN     "client_request_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "idea_publications" ADD COLUMN     "adoption_mode" "IdeaAdoptionMode" NOT NULL DEFAULT 'NON_EXCLUSIVE',
ADD COLUMN     "allow_adoption" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maximum_adoptions" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "idea_publication_acceptances_user_id_client_request_id_key" ON "idea_publication_acceptances"("user_id", "client_request_id");
