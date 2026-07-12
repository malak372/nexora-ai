import { Injectable } from '@nestjs/common';
import { ApiRequestType } from '@prisma/client';

import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';

import {
  AI_ENHANCEMENT_OUTPUT_SCHEMA,
  AI_ENHANCEMENT_RESPONSE_SCHEMA_NAME,
} from '../schemas/ai-enhancement-output.schema';

import type {
  NlpAiClientRequest,
  NlpAiClientResponse,
} from '../types/nlp-ai-client.type';
import type { NlpAiClient } from './nlp-ai-client.interface';

/**
 * Production NLP AI-client implementation backed by the central
 * AI execution service.
 *
 * This adapter translates the NLP-specific enhancement contract into
 * the provider-neutral runtime AI execution contract.
 *
 * Provider selection, retries, timeout handling, fallback, health
 * tracking, and external API logging remain owned by AiExecutionService.
 *
 * @author Eman
 */
@Injectable()
export class AiExecutionNlpClient implements NlpAiClient {
  constructor(private readonly aiExecutionService: AiExecutionService) {}

  /**
   * Executes one structured NLP AI-enhancement request.
   *
   * @param request NLP enhancement request.
   * @returns Normalized NLP AI-client response.
   */
  async enhance(request: NlpAiClientRequest): Promise<NlpAiClientResponse> {
    const result = await this.aiExecutionService.execute({
      userPrompt: request.prompt,
      requestType: ApiRequestType.NLP_ENHANCEMENT,
      responseFormat: AiResponseFormat.JSON,
      responseSchemaName: AI_ENHANCEMENT_RESPONSE_SCHEMA_NAME,
      responseSchema: AI_ENHANCEMENT_OUTPUT_SCHEMA,
      temperature: 0.2,
    });

    return {
      data: JSON.parse(result.text),
      provider: result.provider,
      modelId: result.apiModelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      responseTimeMs: result.responseTimeMs,
      estimatedCost: result.costEstimate,
    };
  }
}
