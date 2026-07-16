import { BadRequestException, Injectable } from '@nestjs/common';

import {
  ApiRequestType,
  ExternalServiceCategory,
  Prisma,
} from '@prisma/client';

import type { ExternalApiLog } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  AI_TEXT_GENERATION_ENDPOINT,
  MAX_AI_ERROR_MESSAGE_LENGTH,
} from '../constants';

import {
  isAiProviderKey,
  type AiProviderKey,
} from '../constants/ai-provider.constants';

/**
 * Input required to persist one external AI-provider attempt.
 *
 * One logical AI operation may create multiple log records because of:
 * - Provider retries.
 * - Structured-output repair.
 * - Model fallback.
 * - Provider fallback.
 *
 * @author Malak
 */
export type CreateExternalAiLogInput = {
  /**
   * Identifier shared by all attempts belonging to one logical AI
   * operation.
   */
  readonly operationId: string;

  /**
   * Sequential external-request number inside the operation.
   */
  readonly attemptNumber: number;

  /**
   * Indicates whether this request used a fallback model.
   */
  readonly fallbackUsed: boolean;

  /**
   * Database identifier of the selected AI model.
   */
  readonly aiModelId: string;

  /**
   * Stable backend provider-registry key.
   */
  readonly providerKey: AiProviderKey;

  /**
   * Exact provider-side model identifier.
   */
  readonly apiModelId: string;

  /**
   * Business-level external request category.
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
   * Optional provider request identifier.
   */
  readonly requestId?: string;

  /**
   * Optional endpoint or internal operation label.
   */
  readonly endpoint?: string;

  /**
   * Optional HTTP status code returned by the provider.
   */
  readonly statusCode?: number;

  /**
   * Whether this individual provider request succeeded.
   */
  readonly isSuccess: boolean;

  /**
   * Duration of this individual provider request in milliseconds.
   */
  readonly responseTimeMs: number;

  /**
   * Provider-reported input-token count.
   */
  readonly inputTokens?: number;

  /**
   * Provider-reported output-token count.
   */
  readonly outputTokens?: number;

  /**
   * Estimated monetary cost of this individual provider request.
   */
  readonly costEstimate?: number;

  /**
   * Safe normalized error message.
   */
  readonly errorMessage?: string;
};

/**
 * Persists individual external AI-provider attempts.
 *
 * One ExternalApiLog record is created for every actual external
 * provider request, including failed retries and repair requests.
 *
 * This service does not:
 * - Select AI models.
 * - Execute providers.
 * - Decide retry eligibility.
 * - Calculate token usage.
 * - Calculate provider cost.
 *
 * @author Malak
 */
@Injectable()
export class ExternalAiLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists one normalized provider request.
   *
   * @param input External AI request metadata.
   * @returns Persisted ExternalApiLog record.
   */
  async create(input: CreateExternalAiLogInput): Promise<ExternalApiLog> {
    this.validateInput(input);

    const operationId = input.operationId.trim();

    const aiModelId = input.aiModelId.trim();

    const apiModelId = input.apiModelId.trim();

    const endpoint = input.endpoint?.trim() || AI_TEXT_GENERATION_ENDPOINT;

    const requestId = input.requestId?.trim() || null;

    return this.prisma.externalApiLog.create({
      data: {
        serviceCategory: ExternalServiceCategory.AI,

        operationId,

        attemptNumber: input.attemptNumber,

        fallbackUsed: input.fallbackUsed,

        userId: this.normalizeOptionalString(input.userId),

        ideaId: this.normalizeOptionalString(input.ideaId),

        aiModelId,

        providerKey: input.providerKey,

        apiModelId,

        endpoint,

        requestId,

        requestType: input.requestType,

        statusCode: input.statusCode ?? null,

        isSuccess: input.isSuccess,

        responseTimeMs: input.responseTimeMs,

        inputTokens: input.inputTokens ?? null,

        outputTokens: input.outputTokens ?? null,

        costEstimate:
          input.costEstimate !== undefined
            ? new Prisma.Decimal(input.costEstimate)
            : null,

        errorMessage: this.normalizeErrorMessage(input.errorMessage),
      },
    });
  }

  /**
   * Validates log values before persistence.
   */
  private validateInput(input: CreateExternalAiLogInput): void {
    if (!input.operationId.trim()) {
      throw new BadRequestException('AI log operationId is required.');
    }

    if (!input.aiModelId.trim()) {
      throw new BadRequestException('AI log aiModelId is required.');
    }

    if (!input.apiModelId.trim()) {
      throw new BadRequestException('AI log apiModelId is required.');
    }

    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
      throw new BadRequestException(
        'AI log attemptNumber must be a positive integer.',
      );
    }

    if (!Number.isInteger(input.responseTimeMs) || input.responseTimeMs < 0) {
      throw new BadRequestException(
        'AI log responseTimeMs must be a non-negative integer.',
      );
    }

    if (!isAiProviderKey(input.providerKey)) {
      throw new BadRequestException(
        `Unsupported AI provider key: ${String(input.providerKey)}`,
      );
    }

    if (input.endpoint !== undefined && !input.endpoint.trim()) {
      throw new BadRequestException(
        'AI log endpoint must not be blank when provided.',
      );
    }

    this.validateOptionalNonNegativeInteger(input.inputTokens, 'inputTokens');

    this.validateOptionalNonNegativeInteger(input.outputTokens, 'outputTokens');

    if (
      input.costEstimate !== undefined &&
      (!Number.isFinite(input.costEstimate) || input.costEstimate < 0)
    ) {
      throw new BadRequestException(
        'AI log costEstimate must be a non-negative finite number.',
      );
    }

    if (
      input.statusCode !== undefined &&
      (!Number.isInteger(input.statusCode) ||
        input.statusCode < 100 ||
        input.statusCode > 599)
    ) {
      throw new BadRequestException(
        'AI log statusCode must be a valid HTTP status code.',
      );
    }
  }

  /**
   * Validates an optional non-negative integer.
   *
   * @param value Value being validated.
   * @param fieldName Field name used in the validation message.
   */
  private validateOptionalNonNegativeInteger(
    value: number | undefined,
    fieldName: string,
  ): void {
    if (value === undefined) {
      return;
    }

    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(
        `AI log ${fieldName} must be a non-negative integer.`,
      );
    }
  }

  /**
   * Normalizes an optional database identifier.
   *
   * Blank optional values become null.
   */
  private normalizeOptionalString(value: string | undefined): string | null {
    const normalizedValue = value?.trim();

    return normalizedValue || null;
  }

  /**
   * Normalizes an error message before persistence.
   *
   * Blank messages become null. Non-empty messages are whitespace
   * normalized and truncated to the configured database-safe limit.
   */
  private normalizeErrorMessage(errorMessage?: string): string | null {
    const normalizedMessage = errorMessage?.replace(/\s+/g, ' ').trim();

    if (!normalizedMessage) {
      return null;
    }

    return normalizedMessage.slice(0, MAX_AI_ERROR_MESSAGE_LENGTH);
  }
}
