-- CreateTable
CREATE TABLE "idea_generation_candidates" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "ai_model_id" TEXT,
    "provider_key" TEXT NOT NULL,
    "api_model_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "display_name" TEXT,
    "raw_response" TEXT,
    "parsed_response" JSONB,
    "overall_score" DECIMAL(5,2),
    "innovation_score" DECIMAL(5,2),
    "market_fit_score" DECIMAL(5,2),
    "technical_quality_score" DECIMAL(5,2),
    "completeness_score" DECIMAL(5,2),
    "originality_score" DECIMAL(5,2),
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "response_time_ms" INTEGER,
    "cost_estimate" DECIMAL(12,6),
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_generation_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idea_generation_candidates_run_id_selected_idx" ON "idea_generation_candidates"("run_id", "selected");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_ai_model_id_idx" ON "idea_generation_candidates"("ai_model_id");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_provider_key_api_model_id_idx" ON "idea_generation_candidates"("provider_key", "api_model_id");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_overall_score_idx" ON "idea_generation_candidates"("overall_score");

-- CreateIndex
CREATE INDEX "idea_generation_candidates_created_at_idx" ON "idea_generation_candidates"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idea_generation_candidates_run_id_provider_key_api_model_id_key" ON "idea_generation_candidates"("run_id", "provider_key", "api_model_id");

-- AddForeignKey
ALTER TABLE "idea_generation_candidates" ADD CONSTRAINT "idea_generation_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "idea_generation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_generation_candidates" ADD CONSTRAINT "idea_generation_candidates_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ensure all quality scores remain within the supported 0–100 range.
ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_overall_score_check"
CHECK (
  "overall_score" IS NULL
  OR "overall_score" BETWEEN 0 AND 100
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_innovation_score_check"
CHECK (
  "innovation_score" IS NULL
  OR "innovation_score" BETWEEN 0 AND 100
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_market_fit_score_check"
CHECK (
  "market_fit_score" IS NULL
  OR "market_fit_score" BETWEEN 0 AND 100
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_technical_quality_score_check"
CHECK (
  "technical_quality_score" IS NULL
  OR "technical_quality_score" BETWEEN 0 AND 100
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_completeness_score_check"
CHECK (
  "completeness_score" IS NULL
  OR "completeness_score" BETWEEN 0 AND 100
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_originality_score_check"
CHECK (
  "originality_score" IS NULL
  OR "originality_score" BETWEEN 0 AND 100
);

-- Token counts, execution time, and estimated cost cannot be negative.
ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_input_tokens_check"
CHECK (
  "input_tokens" IS NULL
  OR "input_tokens" >= 0
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_output_tokens_check"
CHECK (
  "output_tokens" IS NULL
  OR "output_tokens" >= 0
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_response_time_check"
CHECK (
  "response_time_ms" IS NULL
  OR "response_time_ms" >= 0
);

ALTER TABLE "idea_generation_candidates"
ADD CONSTRAINT "idea_generation_candidates_cost_check"
CHECK (
  "cost_estimate" IS NULL
  OR "cost_estimate" >= 0
);

-- Protect against accidentally selecting multiple winners for one run.
CREATE UNIQUE INDEX "idea_generation_candidates_one_selected_per_run_idx"
ON "idea_generation_candidates" ("run_id")
WHERE "selected" = TRUE;