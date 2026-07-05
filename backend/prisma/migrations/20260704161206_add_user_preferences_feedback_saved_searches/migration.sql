-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "preferred_country" TEXT,
    "preferred_city" TEXT,
    "preferred_region" TEXT,
    "preferred_language" TEXT,
    "preferred_domains" JSONB,
    "preferred_platforms" JSONB,
    "preferred_technologies" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_feedback" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_generation_searches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT,
    "domain_id" TEXT,
    "country" TEXT,
    "city" TEXT,
    "region" TEXT,
    "language" TEXT,
    "platforms" JSONB,
    "keywords" JSONB,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_generation_searches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "idea_feedback_idea_id_idx" ON "idea_feedback"("idea_id");

-- CreateIndex
CREATE UNIQUE INDEX "idea_feedback_user_id_idea_id_key" ON "idea_feedback"("user_id", "idea_id");

-- CreateIndex
CREATE INDEX "saved_generation_searches_user_id_idx" ON "saved_generation_searches"("user_id");

-- CreateIndex
CREATE INDEX "saved_generation_searches_domain_id_idx" ON "saved_generation_searches"("domain_id");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_feedback" ADD CONSTRAINT "idea_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_feedback" ADD CONSTRAINT "idea_feedback_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_generation_searches" ADD CONSTRAINT "saved_generation_searches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_generation_searches" ADD CONSTRAINT "saved_generation_searches_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
