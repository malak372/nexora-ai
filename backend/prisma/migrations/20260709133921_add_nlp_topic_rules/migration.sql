-- CreateTable
CREATE TABLE "nlp_topic_rules" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "domain_id" TEXT,
    "language" "LanguageCode" NOT NULL DEFAULT 'ANY',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nlp_topic_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nlp_topic_rules_domain_id_idx" ON "nlp_topic_rules"("domain_id");

-- CreateIndex
CREATE INDEX "nlp_topic_rules_language_idx" ON "nlp_topic_rules"("language");

-- CreateIndex
CREATE INDEX "nlp_topic_rules_is_active_idx" ON "nlp_topic_rules"("is_active");

-- AddForeignKey
ALTER TABLE "nlp_topic_rules" ADD CONSTRAINT "nlp_topic_rules_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
