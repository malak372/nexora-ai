/*
  Warnings:

  - You are about to drop the `favorite_publications` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."favorite_publications" DROP CONSTRAINT "favorite_publications_publication_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."favorite_publications" DROP CONSTRAINT "favorite_publications_user_id_fkey";

-- DropTable
DROP TABLE "public"."favorite_publications";

-- CreateTable
CREATE TABLE "favorite_ideas" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorite_ideas_user_id_created_at_idx" ON "favorite_ideas"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "favorite_ideas_idea_id_idx" ON "favorite_ideas"("idea_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_ideas_user_id_idea_id_key" ON "favorite_ideas"("user_id", "idea_id");

-- AddForeignKey
ALTER TABLE "favorite_ideas" ADD CONSTRAINT "favorite_ideas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_ideas" ADD CONSTRAINT "favorite_ideas_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
