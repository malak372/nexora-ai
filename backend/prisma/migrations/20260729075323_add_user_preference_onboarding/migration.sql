-- CreateEnum
CREATE TYPE "PreferenceCategory" AS ENUM ('DOMAIN', 'PROJECT_TYPE', 'TARGET_AUDIENCE', 'USER_GOAL', 'TECHNOLOGY', 'DATA_SOURCE');

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "last_refreshed_at" TIMESTAMP(3),
ADD COLUMN     "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboarding_completed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "preference_options" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "PreferenceCategory" NOT NULL,
    "image_url" TEXT,
    "icon_key" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preference_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preference_selections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "preference_option_id" TEXT NOT NULL,
    "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preference_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "preference_options_key_key" ON "preference_options"("key");

-- CreateIndex
CREATE INDEX "preference_options_category_is_active_display_order_idx" ON "preference_options"("category", "is_active", "display_order");

-- CreateIndex
CREATE INDEX "user_preference_selections_user_id_idx" ON "user_preference_selections"("user_id");

-- CreateIndex
CREATE INDEX "user_preference_selections_preference_option_id_idx" ON "user_preference_selections"("preference_option_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preference_selections_user_id_preference_option_id_key" ON "user_preference_selections"("user_id", "preference_option_id");

-- AddForeignKey
ALTER TABLE "user_preference_selections" ADD CONSTRAINT "user_preference_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preference_selections" ADD CONSTRAINT "user_preference_selections_preference_option_id_fkey" FOREIGN KEY ("preference_option_id") REFERENCES "preference_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;
