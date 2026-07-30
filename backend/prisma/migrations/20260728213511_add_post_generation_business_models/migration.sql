-- CreateTable
CREATE TABLE "idea_business_models" (
    "id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "business_model_template_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_business_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idea_business_models_idea_id_is_current_idx" ON "idea_business_models"("idea_id", "is_current");

-- CreateIndex
CREATE INDEX "idea_business_models_business_model_template_id_idx" ON "idea_business_models"("business_model_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "idea_business_models_idea_id_version_key" ON "idea_business_models"("idea_id", "version");

-- AddForeignKey
ALTER TABLE "idea_business_models" ADD CONSTRAINT "idea_business_models_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_business_models" ADD CONSTRAINT "idea_business_models_business_model_template_id_fkey" FOREIGN KEY ("business_model_template_id") REFERENCES "business_model_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
