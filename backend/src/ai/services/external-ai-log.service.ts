import {
  Injectable,
} from '@nestjs/common';
import {
  AiProviderType,
  ApiRequestType,
  ExternalApiLog,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  AI_PROVIDER_TO_API_PROVIDER,
  AI_TEXT_GENERATION_ENDPOINT,
  MAX_AI_ERROR_MESSAGE_LENGTH,
} from '../constants';

/**
 * Input required to persist one external AI-provider attempt.
 *
 * One logical AI operation may create multiple records when:
 * - The same model is retried.
 * - A fallback model is selected.
 * - A fallback provider is selected.
 *
 * Only the model values required for logging are accepted instead of
 * the complete Prisma AiModel entity. This reduces coupling between
 * logging and model-management concerns.
 *
 * @author Malak
 */
export type CreateExternalAiLogInput = {
  /**
   * Identifier shared by all attempts belonging to the same logical
   * AI operation.
   */
  readonly operationId: string;

  /**
   * Sequential attempt number inside the logical operation.
   *
   * The initial external request uses attempt number one.
   */
  readonly attemptNumber: number;

  /**
   * Indicates whether this attempt used a model other than the first
   * candidate selected for the logical operation.
   */
  readonly fallbackUsed: boolean;

  /**
   * Database identifier of the AI model used for this attempt.
   */
  readonly aiModelId: string;

  /**
   * Provider associated with the selected AI model.
   */
  readonly provider: AiProviderType;

  /**
   * Exact provider-side model identifier.
   */
  readonly apiModelId: string;

  /**
   * Business-level category of the external API request.
   */
  readonly requestType: ApiRequestType;

  /**
   * Optional authenticated user associated with the operation.
   */
  readonly userId?: string;

  /**
   * Optional generated idea associated with the operation.
   */
  readonly ideaId?: string;

  /**
   * Optional provider request identifier used for tracing and support.
   */
  readonly requestId?: string;

  /**
   * Optional internal endpoint or operation label.
   *
   * Defaults to AI_TEXT_GENERATION_ENDPOINT.
   */
  readonly endpoint?: string;

  /**
   * Optional HTTP status code returned by the provider.
   */
  readonly statusCode?: number;

  /**
   * Indicates whether this individual provider attempt succeeded.
   */
  readonly isSuccess: boolean;

  /**
   * Duration of this individual provider attempt in milliseconds.
   *
   * This excludes other retries and fallback requests.
   */
  readonly responseTimeMs: number;

  /**
   * Actual input-token count reported by the provider.
   */
  readonly inputTokens?: number;

  /**
   * Actual output-token count reported by the provider.
   */
  readonly outputTokens?: number;

  /**
   * Estimated monetary cost of this individual attempt.
   *
   * Nexora AI should use one consistent currency, preferably USD.
   */
  readonly costEstimate?: number;

  /**
   * Optional safe normalized error message.
   *
   * Stack traces, API keys, raw provider bodies, and sensitive
   * application information must not be stored here.
   */
  readonly errorMessage?: string;
};

/**
 * Persists external AI-provider execution attempts.
 *
 * One ExternalApiLog record is created for every individual provider
 * call, including failed retries and fallback attempts.
 *
 * Responsibilities:
 * - Persist normalized attempt metadata.
 * - Map AiProviderType to ApiProvider.
 * - Convert cost values to Prisma Decimal.
 * - Normalize and limit stored error messages.
 *
 * This service does not:
 * - Select AI models.
 * - Execute provider requests.
 * - Calculate token usage.
 * - Calculate provider cost.
 * - Decide retry or fallback eligibility.
 *
 * @author Malak
 */
@Injectable()
export class ExternalAiLogService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  /**
   * Persists one external AI-provider attempt.
   *
   * Retries and fallback attempts invoke this method separately while
   * preserving the same operationId.
   *
   * @param input Normalized attempt logging data.
   * @returns Persisted ExternalApiLog record.
   */
  async create(
    input: CreateExternalAiLogInput,
  ): Promise<ExternalApiLog> {
    return this.prisma.externalApiLog.create({
      data: {
        operationId:
          input.operationId,

        attemptNumber:
          input.attemptNumber,

        fallbackUsed:
          input.fallbackUsed,

        userId:
          input.userId ?? null,

        ideaId:
          input.ideaId ?? null,

        aiModelId:
          input.aiModelId,

        provider:
          AI_PROVIDER_TO_API_PROVIDER[
            input.provider
          ],

        apiModelId:
          input.apiModelId,

        endpoint:
          input.endpoint?.trim() ||
          AI_TEXT_GENERATION_ENDPOINT,

        requestId:
          input.requestId ?? null,

        requestType:
          input.requestType,

        statusCode:
          input.statusCode ?? null,

        isSuccess:
          input.isSuccess,

        responseTimeMs:
          input.responseTimeMs,

        inputTokens:
          input.inputTokens ?? null,

        outputTokens:
          input.outputTokens ?? null,

        costEstimate:
          input.costEstimate !== undefined
            ? new Prisma.Decimal(
                input.costEstimate,
              )
            : null,

        errorMessage:
          this.normalizeErrorMessage(
            input.errorMessage,
          ),
      },
    });
  }

  /**
   * Normalizes an error message before persistence.
   *
   * Blank messages become null. Non-empty messages are trimmed and
   * limited to MAX_AI_ERROR_MESSAGE_LENGTH.
   *
   * @param errorMessage Optional normalized provider error message.
   * @returns Safe database value.
   */
  private normalizeErrorMessage(
    errorMessage?: string,
  ): string | null {
    const normalizedMessage =
      errorMessage?.trim();

    if (!normalizedMessage) {
      return null;
    }

    return normalizedMessage.slice(
      0,
      MAX_AI_ERROR_MESSAGE_LENGTH,
    );
  }
}