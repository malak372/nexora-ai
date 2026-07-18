import { Injectable } from '@nestjs/common';
import { ApiRequestType, PromptType } from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { AiResponseParserService } from '../../../ai/services/ai-response-parser.service';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';

import {
  AI_ENHANCEMENT_OUTPUT_SCHEMA,
  AI_ENHANCEMENT_RESPONSE_SCHEMA_NAME,
} from '../schemas/ai-enhancement-output.schema';

import type { NlpAiClientRequest } from '../types/nlp-ai-client.type';
import type { NlpAiClientResponse } from '../types/nlp-ai-client.type';

import type { NlpAiClient } from './nlp-ai-client.interface';

/**
 * Deterministic temperature used for analytical NLP enhancement.
 *
 * A low value is preferred because the operation refines an existing
 * evidence-based analysis rather than generating creative content.
 */
const NLP_AI_ENHANCEMENT_TEMPERATURE = 0.2;

/**
 * Production NLP AI-client adapter backed by the central AI runtime.
 *
 * This adapter forms the integration boundary between:
 *
 * NlpModule
 * → AiExecutionService
 * → configured AI providers
 *
 * Responsibilities:
 * - Translate the NLP-specific request contract into AiExecutionInput.
 * - Supply the NLP enhancement JSON Schema to the central AI runtime.
 * - Classify the operation correctly for logging and analytics.
 * - Parse the validated JSON text returned by AiExecutionService.
 * - Normalize provider and usage metadata for the NLP layer.
 *
 * The adapter intentionally does not:
 * - Select an AI model or provider.
 * - Implement retry, timeout, fallback, or health logic.
 * - Validate evidence identifiers.
 * - Merge AI output with rule-based analysis.
 * - Persist NLP results.
 *
 * Provider routing, retries, fallback, response repair, health
 * tracking, cost calculation, and ExternalApiLog persistence remain
 * owned by AiExecutionService.
 *
 * Domain-level validation remains owned by
 * AiAnalysisOutputValidatorService because JSON Schema validation
 * cannot verify whether returned evidence identifiers were actually
 * supplied by the NLP pipeline.
 *
 * @author Eman
 */
@Injectable()
export class AiExecutionNlpClient implements NlpAiClient {
  constructor(
    private readonly aiExecutionService: AiExecutionService,
    private readonly aiResponseParserService: AiResponseParserService,
  ) { }

  /**
   * Executes one structured NLP AI-enhancement operation.
   *
   * AiExecutionService validates the provider response against
   * AI_ENHANCEMENT_OUTPUT_SCHEMA before returning successful text.
   *
   * The parsed value remains unknown so the NLP-specific validator
   * can enforce evidence references and domain business rules.
   *
   * The central AI runtime owns operation-ID generation across retry
   * and fallback attempts. The authoritative operation identifier is
   * persisted through the central ExternalApiLog workflow.
   *
   * @param request Fully rendered NLP AI-enhancement request.
   * @returns Normalized parsed response and execution metadata.
   */
  async enhance(request: NlpAiClientRequest): Promise<NlpAiClientResponse> {
    const result = await this.aiExecutionService.execute({
      userPrompt: request.prompt,
      requestType: ApiRequestType.NLP_ENHANCEMENT,
      promptType: PromptType.NLP_ANALYSIS,
      responseFormat: AiResponseFormat.JSON,
      responseSchema: AI_ENHANCEMENT_OUTPUT_SCHEMA,
      responseSchemaName: AI_ENHANCEMENT_RESPONSE_SCHEMA_NAME,
      temperature: NLP_AI_ENHANCEMENT_TEMPERATURE,
    });

    const data: unknown = this.aiResponseParserService.parseJson(result.text);

    return {
      data,
      provider: result.provider,
      modelId: result.apiModelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      responseTimeMs: result.responseTimeMs,
      estimatedCost: result.costEstimate,
    };
  }
}