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
 * Monetary value accepted when persisting an estimated provider cost.
 *
 * Prisma.Decimal and decimal strings are supported to avoid unnecessary
 * precision loss when callers already calculate costs using decimal
 * arithmetic.
 */
export type ExternalAiLogCost = number | string | Prisma.Decimal;

/**
 * Input required to persist one external AI-provider request attempt.
 *
 * One logical AI operation may create multiple log records because of:
 * - Provider retries.
 * - Structured-output repair attempts.
 * - Model fallback.
 * - Provider fallback.
 *
 * Every input instance represents exactly one real external provider
 * request.
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
   * Sequential external-request number inside the logical operation.
   *
   * Numbering starts from one.
   */
  readonly attemptNumber: number;

  /**
   * Indicates whether this request used a fallback model or provider
   * selection.
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
   *
   * Examples may include provider model slugs or versioned model names.
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
   * Optional provider-generated request identifier.
   *
   * This value may be used for provider support and troubleshooting.
   */
  readonly requestId?: string;

  /**
   * Optional endpoint or internal provider-operation label.
   *
   * When omitted, the standard AI text-generation endpoint label is
   * stored.
   */
  readonly endpoint?: string;

  /**
   * Optional HTTP status code returned by the provider or provider SDK.
   */
  readonly statusCode?: number;

  /**
   * Indicates whether this individual provider request succeeded.
   */
  readonly isSuccess: boolean;

  /**
   * Duration of this individual provider request in milliseconds.
   */
  readonly responseTimeMs: number;

  /**
   * Optional provider-reported input-token count.
   */
  readonly inputTokens?: number;

  /**
   * Optional provider-reported output-token count.
   */
  readonly outputTokens?: number;

  /**
   * Optional estimated monetary cost of this provider request.
   *
   * Decimal strings or Prisma.Decimal values are preferred when exact
   * financial precision is important.
   */
  readonly costEstimate?: ExternalAiLogCost;

  /**
   * Optional safe normalized error message.
   *
   * Raw provider responses, credentials, authorization headers, and
   * secrets must never be supplied in this field.
   */
  readonly errorMessage?: string;
};

/**
 * Persists individual external AI-provider request attempts.
 *
 * One ExternalApiLog record is created for every actual external
 * provider request, including:
 * - Successful requests.
 * - Failed retry attempts.
 * - Structured-output repair requests.
 * - Model fallback requests.
 * - Provider fallback requests.
 *
 * Responsibilities:
 * - Validate log metadata.
 * - Normalize required and optional textual values.
 * - Validate numeric usage and timing values.
 * - Convert monetary cost values to Prisma.Decimal.
 * - Bound persisted error-message length.
 * - Persist one ExternalApiLog record.
 *
 * This service does not:
 * - Select providers or models.
 * - Execute external requests.
 * - Decide retry eligibility.
 * - Calculate token usage.
 * - Calculate provider cost.
 * - Sanitize arbitrary secrets from raw provider payloads.
 *
 * Callers must provide only safe normalized error messages.
 *
 * @author Malak
 */
@Injectable()
export class ExternalAiLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists one normalized external AI-provider request attempt.
   *
   * @param input External provider-request metadata.
   * @returns Persisted ExternalApiLog record.
   *
   * @throws BadRequestException when supplied log metadata is invalid.
   */
  async create(input: CreateExternalAiLogInput): Promise<ExternalApiLog> {
    this.validateInput(input);

    const operationId = this.normalizeRequiredString(
      input.operationId,
      'operationId',
    );

    const aiModelId = this.normalizeRequiredString(
      input.aiModelId,
      'aiModelId',
    );

    const apiModelId = this.normalizeRequiredString(
      input.apiModelId,
      'apiModelId',
    );

    const endpoint =
      input.endpoint === undefined
        ? AI_TEXT_GENERATION_ENDPOINT
        : this.normalizeRequiredString(input.endpoint, 'endpoint');

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

        requestId: this.normalizeOptionalString(input.requestId),

        requestType: input.requestType,

        statusCode: input.statusCode ?? null,

        isSuccess: input.isSuccess,

        responseTimeMs: input.responseTimeMs,

        inputTokens: input.inputTokens ?? null,

        outputTokens: input.outputTokens ?? null,

        costEstimate: this.normalizeCostEstimate(input.costEstimate),

        errorMessage: this.normalizeErrorMessage(input.errorMessage),
      },
    });
  }

  /**
   * Validates all supplied log values before database persistence.
   *
   * Runtime validation is retained even though TypeScript defines the
   * expected input shape. It protects the service from:
   * - JavaScript callers.
   * - Unsafe casts.
   * - Dynamically constructed objects.
   * - Invalid values passed by future integrations.
   *
   * @param input Candidate external AI log input.
   * @throws BadRequestException when any supplied value is invalid.
   */
  private validateInput(input: CreateExternalAiLogInput): void {
    if (typeof input !== 'object' || input === null) {
      throw new BadRequestException('External AI log input is required.');
    }

    this.validateRequiredString(input.operationId, 'operationId');

    this.validateRequiredString(input.aiModelId, 'aiModelId');

    this.validateRequiredString(input.apiModelId, 'apiModelId');

    this.validatePositiveSafeInteger(input.attemptNumber, 'attemptNumber');

    this.validateNonNegativeSafeInteger(input.responseTimeMs, 'responseTimeMs');

    this.validateBoolean(input.fallbackUsed, 'fallbackUsed');

    this.validateBoolean(input.isSuccess, 'isSuccess');

    if (!isAiProviderKey(input.providerKey)) {
      throw new BadRequestException(
        `Unsupported AI provider key: ${String(input.providerKey)}.`,
      );
    }

    if (!Object.values(ApiRequestType).includes(input.requestType)) {
      throw new BadRequestException(
        `Unsupported AI request type: ${String(input.requestType)}.`,
      );
    }

    this.validateOptionalString(input.userId, 'userId');

    this.validateOptionalString(input.ideaId, 'ideaId');

    this.validateOptionalString(input.requestId, 'requestId');

    this.validateOptionalString(input.endpoint, 'endpoint', false);

    this.validateOptionalString(input.errorMessage, 'errorMessage', true);

    this.validateOptionalNonNegativeSafeInteger(
      input.inputTokens,
      'inputTokens',
    );

    this.validateOptionalNonNegativeSafeInteger(
      input.outputTokens,
      'outputTokens',
    );

    this.validateOptionalHttpStatusCode(input.statusCode);

    this.validateOptionalCostEstimate(input.costEstimate);

    if (input.isSuccess && input.errorMessage?.trim()) {
      throw new BadRequestException(
        'AI log errorMessage must not be provided for a successful request.',
      );
    }
  }

  /**
   * Validates one required non-blank string.
   *
   * @param value Candidate value.
   * @param fieldName Field name used in validation messages.
   */
  private validateRequiredString(value: unknown, fieldName: string): void {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`AI log ${fieldName} is required.`);
    }
  }

  /**
   * Validates one optional string.
   *
   * @param value Candidate value.
   * @param fieldName Field name used in validation messages.
   * @param allowBlank Whether a blank string is accepted and normalized
   * to null.
   */
  private validateOptionalString(
    value: unknown,
    fieldName: string,
    allowBlank = true,
  ): void {
    if (value === undefined) {
      return;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(
        `AI log ${fieldName} must be a string when provided.`,
      );
    }

    if (!allowBlank && !value.trim()) {
      throw new BadRequestException(
        `AI log ${fieldName} must not be blank when provided.`,
      );
    }
  }

  /**
   * Validates one required boolean field.
   *
   * @param value Candidate value.
   * @param fieldName Field name used in validation messages.
   */
  private validateBoolean(value: unknown, fieldName: string): void {
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`AI log ${fieldName} must be a boolean.`);
    }
  }

  /**
   * Validates one positive safe integer.
   *
   * @param value Candidate numeric value.
   * @param fieldName Field name used in validation messages.
   */
  private validatePositiveSafeInteger(value: unknown, fieldName: string): void {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1
    ) {
      throw new BadRequestException(
        `AI log ${fieldName} must be a positive safe integer.`,
      );
    }
  }

  /**
   * Validates one non-negative safe integer.
   *
   * @param value Candidate numeric value.
   * @param fieldName Field name used in validation messages.
   */
  private validateNonNegativeSafeInteger(
    value: unknown,
    fieldName: string,
  ): void {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new BadRequestException(
        `AI log ${fieldName} must be a non-negative safe integer.`,
      );
    }
  }

  /**
   * Validates an optional non-negative safe integer.
   *
   * @param value Candidate value.
   * @param fieldName Field name used in validation messages.
   */
  private validateOptionalNonNegativeSafeInteger(
    value: number | undefined,
    fieldName: string,
  ): void {
    if (value === undefined) {
      return;
    }

    this.validateNonNegativeSafeInteger(value, fieldName);
  }

  /**
   * Validates an optional HTTP status code.
   *
   * Valid status codes are integers between 100 and 599.
   *
   * @param statusCode Candidate HTTP status code.
   */
  private validateOptionalHttpStatusCode(statusCode: number | undefined): void {
    if (statusCode === undefined) {
      return;
    }

    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new BadRequestException(
        'AI log statusCode must be a valid HTTP status code.',
      );
    }
  }

  /**
   * Validates an optional monetary cost value.
   *
   * Supported values:
   * - Non-negative finite numbers.
   * - Non-negative decimal strings.
   * - Non-negative Prisma.Decimal instances.
   *
   * @param value Candidate cost estimate.
   */
  private validateOptionalCostEstimate(
    value: ExternalAiLogCost | undefined,
  ): void {
    if (value === undefined) {
      return;
    }

    try {
      const decimalValue =
        value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

      if (!decimalValue.isFinite() || decimalValue.isNegative()) {
        throw new Error('Cost must be finite and non-negative.');
      }
    } catch {
      throw new BadRequestException(
        'AI log costEstimate must be a valid non-negative finite decimal value.',
      );
    }
  }

  /**
   * Normalizes one required string after successful validation.
   *
   * @param value Required textual value.
   * @param fieldName Field name used if runtime validation fails.
   * @returns Trimmed non-empty value.
   */
  private normalizeRequiredString(value: string, fieldName: string): string {
    this.validateRequiredString(value, fieldName);

    return value.trim();
  }

  /**
   * Normalizes an optional textual database value.
   *
   * Undefined and blank strings become null.
   *
   * @param value Optional string.
   * @returns Trimmed string or null.
   */
  private normalizeOptionalString(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue || null;
  }

  /**
   * Converts an optional monetary value to Prisma.Decimal.
   *
   * @param value Optional cost estimate.
   * @returns Prisma.Decimal value or null.
   */
  private normalizeCostEstimate(
    value: ExternalAiLogCost | undefined,
  ): Prisma.Decimal | null {
    if (value === undefined) {
      return null;
    }

    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  }

  /**
   * Normalizes an error message before persistence.
   *
   * Processing:
   * - Blank messages become null.
   * - Repeated whitespace is collapsed.
   * - Leading and trailing whitespace is removed.
   * - The result is truncated to the configured database-safe limit.
   *
   * Callers must ensure the supplied text does not contain credentials,
   * tokens, authorization headers, or complete raw provider payloads.
   *
   * @param errorMessage Optional safe error message.
   * @returns Normalized bounded message or null.
   */
  private normalizeErrorMessage(errorMessage?: string): string | null {
    const normalizedMessage = errorMessage?.replace(/\s+/g, ' ').trim();

    if (!normalizedMessage) {
      return null;
    }

    return normalizedMessage.slice(0, MAX_AI_ERROR_MESSAGE_LENGTH);
  }
}
