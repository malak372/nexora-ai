import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { AiModel, AiRoutingStrategy } from '@prisma/client';

import { randomUUID } from 'crypto';

import { AiModelHealthService } from '../../ai-models/ai-model-health.service';
import { AiModelRoutingService } from '../../ai-models/ai-model-routing.service';

import {
  AI_STRUCTURED_OUTPUT_REPAIR_TEMPERATURE,
  AI_TEXT_GENERATION_ENDPOINT,
  APPROXIMATE_CHARACTERS_PER_TOKEN,
  DEFAULT_AI_ESTIMATED_OUTPUT_TOKENS,
  DEFAULT_AI_MAX_RETRIES_PER_MODEL,
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  DEFAULT_AI_RETRY_BASE_DELAY_MS,
  MAX_AI_REQUEST_TIMEOUT_MS,
  MAX_AI_STRUCTURED_OUTPUT_REPAIRS,
  MIN_AI_REQUEST_TIMEOUT_MS,
} from '../constants';

import {
  normalizeAiProviderKey,
  type AiProviderKey,
} from '../constants/ai-provider.constants';

import { AiProviderErrorCode } from '../errors/ai-provider-error-code.enum';
import { AiProviderError } from '../errors/ai-provider.error';

import { AiProvider } from '../providers/ai-provider.interface';

import { AiExecutionInput } from '../types/ai-execution-input.type';
import { AiExecutionResult } from '../types/ai-execution-result.type';

import {
  AiProviderGenerateResult,
  AiResponseFormat,
} from '../types/ai-provider.type';

import { AiProviderFactoryService } from './ai-provider-factory.service';
import { AiResponseRepairService } from './ai-response-repair.service';

import {
  AiStructuredOutputService,
  StructuredOutputValidationFailure,
} from './ai-structured-output.service';

import { AiTimeoutService } from './ai-timeout.service';
import { ExternalAiLogService } from './external-ai-log.service';

/**
 * Validated response text and its original provider metadata.
 */
type ValidatedProviderResult = {
  readonly text: string;
  readonly providerResult: AiProviderGenerateResult;
};

/**
 * Internal provider-request contract.
 *
 * This contract prevents the execution service from passing arbitrary
 * business values directly to provider adapters.
 */
type ExecuteProviderRequestInput = {
  readonly userPrompt: string;
  readonly systemInstruction?: string;
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  readonly responseFormat?: AiResponseFormat;
  readonly responseSchema?: AiExecutionInput['responseSchema'];
  readonly responseSchemaName?: string;
};

/**
 * Central service responsible for executing logical AI operations.
 *
 * Responsibilities:
 * - Validate execution input.
 * - Route available AI models.
 * - Resolve provider adapters through providerKey.
 * - Apply one cancellable timeout per external request.
 * - Retry temporary provider failures.
 * - Validate structured output.
 * - Perform one bounded structured-output repair request.
 * - Fall back to other routable models.
 * - Update model health.
 * - Persist one ExternalApiLog per external request.
 *
 * The service does not:
 * - Build business prompts.
 * - Persist generated ideas.
 * - Deduct credits.
 * - Resolve administrator permissions.
 *
 * @author Malak
 */
@Injectable()
export class AiExecutionService {
  /**
   * Maximum duration of one external provider request.
   */
  private readonly timeoutMs: number;

  /**
   * Maximum retries after the first attempt for one model.
   */
  private readonly maxRetriesPerModel: number;

  /**
   * Base delay used for exponential retry backoff.
   */
  private readonly retryBaseDelayMs: number;

  constructor(
    private readonly providerFactory: AiProviderFactoryService,

    private readonly modelRoutingService: AiModelRoutingService,

    private readonly modelHealthService: AiModelHealthService,

    private readonly timeoutService: AiTimeoutService,

    private readonly externalLogService: ExternalAiLogService,

    private readonly structuredOutputService: AiStructuredOutputService,

    private readonly responseRepairService: AiResponseRepairService,

    configService: ConfigService,
  ) {
    this.timeoutMs = this.resolveBoundedPositiveIntegerConfig(
      configService,
      'AI_REQUEST_TIMEOUT_MS',
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
      MIN_AI_REQUEST_TIMEOUT_MS,
      MAX_AI_REQUEST_TIMEOUT_MS,
    );

    this.maxRetriesPerModel = this.resolveNonNegativeIntegerConfig(
      configService,
      'AI_MAX_RETRIES_PER_MODEL',
      DEFAULT_AI_MAX_RETRIES_PER_MODEL,
    );

    this.retryBaseDelayMs = this.resolveNonNegativeIntegerConfig(
      configService,
      'AI_RETRY_BASE_DELAY_MS',
      DEFAULT_AI_RETRY_BASE_DELAY_MS,
    );
  }

  /**
   * Executes one complete logical AI operation.
   *
   * One logical operation may contain multiple external requests due
   * to retries, structured-output repair, or model fallback.
   *
   * @param input Business and provider execution contract.
   * @returns Final successful normalized AI response.
   */
  async execute(input: AiExecutionInput): Promise<AiExecutionResult> {
    this.validateExecutionInput(input);

    const operationId = randomUUID();
    const operationStartedAt = Date.now();

    const estimatedInputTokens = this.estimateTokens(
      [input.systemInstruction ?? '', input.userPrompt].join('\n'),
    );

    const estimatedOutputTokens =
      input.estimatedOutputTokens ??
      input.maxOutputTokens ??
      DEFAULT_AI_ESTIMATED_OUTPUT_TOKENS;

    const models = await this.modelRoutingService.resolveExecutionOrder(
      input.strategy ?? AiRoutingStrategy.DEFAULT,
      {
        estimatedInputTokens,
        estimatedOutputTokens,
      },
    );

    if (models.length === 0) {
      throw new ServiceUnavailableException(
        'No available AI models were found for this request.',
      );
    }

    let globalAttemptNumber = 0;

    let lastError: AiProviderError | undefined;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex];

      const fallbackUsed = modelIndex > 0;

      /**
       * Prisma stores providerKey as a string. The factory performs
       * normalization, validation, and adapter resolution.
       */
      const provider = this.providerFactory.getProvider(model.providerKey);

      const totalAttemptsForModel = this.maxRetriesPerModel + 1;

      let finalModelError: AiProviderError | undefined;

      for (
        let modelAttemptNumber = 1;
        modelAttemptNumber <= totalAttemptsForModel;
        modelAttemptNumber += 1
      ) {
        globalAttemptNumber += 1;

        const attemptNumber = globalAttemptNumber;

        const attemptStartedAt = Date.now();

        try {
          const providerResult = await this.executeProviderRequest(
            provider,
            model,
            {
              userPrompt: input.userPrompt,

              systemInstruction: input.systemInstruction,

              maxOutputTokens: this.resolveMaxOutputTokens(
                input.maxOutputTokens,
                model,
              ),

              temperature: input.temperature,

              responseFormat: input.responseFormat,

              /**
               * Providers that support native structured output may
               * use the schema. AJV remains the final application-level
               * validator.
               */
              responseSchema: input.responseSchema,

              responseSchemaName: input.responseSchemaName,
            },
          );

          this.validateProviderMetadata(provider, model, providerResult);

          const validation = this.validateProviderResult(providerResult, input);

          if (validation.success) {
            const successfulResult: ValidatedProviderResult = {
              text: validation.text,
              providerResult,
            };

            await this.recordSuccessfulAttempt(
              operationId,
              attemptNumber,
              fallbackUsed,
              model,
              input,
              successfulResult,
              providerResult.providerLatencyMs,
            );

            return this.buildExecutionResult(
              successfulResult,
              operationId,
              model,
              fallbackUsed,
              globalAttemptNumber,
              operationStartedAt,
            );
          }

          const invalidOutputError = this.createStructuredOutputError(
            validation.failure,
          );

          finalModelError = invalidOutputError;

          lastError = invalidOutputError;

          await this.recordFailedStructuredAttempt(
            operationId,
            attemptNumber,
            fallbackUsed,
            model,
            input,
            providerResult,
            invalidOutputError,
            providerResult.providerLatencyMs,
          );

          if (MAX_AI_STRUCTURED_OUTPUT_REPAIRS > 0) {
            globalAttemptNumber += 1;

            const repairAttemptNumber = globalAttemptNumber;

            const repairResult = await this.executeRepairAttempt(
              provider,
              model,
              input,
              providerResult.text,
              validation.failure,
              operationId,
              repairAttemptNumber,
              fallbackUsed,
            );

            if (repairResult.success) {
              /**
               * The repair logging call does not update health directly.
               * Health is updated here after the complete model flow
               * succeeds.
               */
              await Promise.allSettled([
                this.modelHealthService.recordSuccess(model.id),
              ]);

              return this.buildExecutionResult(
                repairResult.result,
                operationId,
                model,
                fallbackUsed,
                globalAttemptNumber,
                operationStartedAt,
              );
            }

            finalModelError = repairResult.error;

            lastError = repairResult.error;
          }

          /**
           * Invalid structured output is not processed by the normal
           * retry loop. A dedicated repair request was already used.
           */
          break;
        } catch (error: unknown) {
          const normalizedError = this.normalizeError(error);

          finalModelError = normalizedError;

          lastError = normalizedError;

          await this.recordFailedProviderAttempt(
            operationId,
            attemptNumber,
            fallbackUsed,
            model,
            input,
            normalizedError,
            Date.now() - attemptStartedAt,
          );

          const hasAnotherAttempt = modelAttemptNumber < totalAttemptsForModel;

          if (normalizedError.retryable && hasAnotherAttempt) {
            await this.delay(this.calculateRetryDelay(modelAttemptNumber));

            continue;
          }

          break;
        }
      }

      if (finalModelError) {
        await Promise.allSettled([
          this.modelHealthService.recordFailure(model.id),
        ]);
      }

      if (!finalModelError) {
        continue;
      }

      if (!this.shouldFallback(finalModelError)) {
        throw finalModelError;
      }
    }

    throw new ServiceUnavailableException(
      lastError
        ? `All configured AI models failed: ${lastError.message}`
        : 'All configured AI models failed.',
    );
  }

  /**
   * Executes one provider request with a cancellable per-attempt
   * timeout.
   */
  private executeProviderRequest(
    provider: AiProvider,
    model: AiModel,
    request: ExecuteProviderRequestInput,
  ): Promise<AiProviderGenerateResult> {
    return this.timeoutService.execute(
      (signal) =>
        provider.generate({
          apiModelId: model.apiModelId,

          userPrompt: request.userPrompt,

          systemInstruction: request.systemInstruction,

          maxOutputTokens: request.maxOutputTokens,

          temperature: request.temperature,

          responseFormat: request.responseFormat,

          responseSchema: request.responseSchema,

          responseSchemaName: request.responseSchemaName,

          signal,
        }),

      this.timeoutMs,
    );
  }

  /**
   * Verifies that adapter and response metadata match the model selected
   * by the routing layer.
   *
   * This protects logging and result metadata from an incorrectly
   * implemented provider adapter.
   */
  private validateProviderMetadata(
    provider: AiProvider,
    model: AiModel,
    result: AiProviderGenerateResult,
  ): void {
    const expectedProviderKey = this.requireProviderKey(model.providerKey);

    if (
      provider.providerKey !== expectedProviderKey ||
      result.providerKey !== expectedProviderKey
    ) {
      throw new AiProviderError(
        'The AI provider returned inconsistent provider metadata.',
        AiProviderErrorCode.UNKNOWN,
        false,
      );
    }

    if (result.apiModelId !== model.apiModelId) {
      throw new AiProviderError(
        'The AI provider returned inconsistent model metadata.',
        AiProviderErrorCode.UNKNOWN,
        false,
      );
    }
  }

  /**
   * Validates one provider result according to the expected response
   * format and the caller-supplied JSON Schema.
   */
  private validateProviderResult(
    providerResult: AiProviderGenerateResult,

    input: AiExecutionInput,
  ):
    | {
        readonly success: true;
        readonly text: string;
      }
    | {
        readonly success: false;
        readonly failure: StructuredOutputValidationFailure;
      } {
    if (input.responseFormat !== AiResponseFormat.JSON) {
      return {
        success: true,
        text: providerResult.text,
      };
    }

    /**
     * validateExecutionInput guarantees both values are available for
     * JSON structured-output operations.
     */
    const responseSchema = input.responseSchema!;

    const responseSchemaName = input.responseSchemaName!.trim();

    const validation = this.structuredOutputService.safeValidateSchema(
      providerResult.text,
      responseSchema,
      responseSchemaName,
    );

    if (!validation.success) {
      return {
        success: false,
        failure: validation,
      };
    }

    return {
      success: true,

      /**
       * Return normalized validated JSON without provider commentary,
       * Markdown fences, or additional unsupported text.
       */
      text: JSON.stringify(validation.data),
    };
  }

  /**
   * Executes one bounded structured-output repair request.
   */
  private async executeRepairAttempt(
    provider: AiProvider,
    model: AiModel,
    input: AiExecutionInput,
    invalidResponse: string,

    validationFailure: StructuredOutputValidationFailure,

    operationId: string,
    attemptNumber: number,
    fallbackUsed: boolean,
  ): Promise<
    | {
        readonly success: true;
        readonly result: ValidatedProviderResult;
      }
    | {
        readonly success: false;
        readonly error: AiProviderError;
      }
  > {
    const repairPrompt = this.responseRepairService.buildRepairPrompt({
      originalPrompt: input.userPrompt,

      invalidResponse,

      validationIssues: validationFailure.issues,
    });

    const repairStartedAt = Date.now();

    try {
      const providerResult = await this.executeProviderRequest(
        provider,
        model,
        {
          userPrompt: repairPrompt,

          systemInstruction:
            this.responseRepairService.buildSystemInstruction(),

          maxOutputTokens: this.resolveMaxOutputTokens(
            input.maxOutputTokens,
            model,
          ),

          temperature: AI_STRUCTURED_OUTPUT_REPAIR_TEMPERATURE,

          responseFormat: AiResponseFormat.JSON,

          /**
           * Repair must target the same structured-output contract as
           * the original operation.
           */
          responseSchema: input.responseSchema,

          responseSchemaName: input.responseSchemaName,
        },
      );

      this.validateProviderMetadata(provider, model, providerResult);

      const validation = this.validateProviderResult(providerResult, input);

      if (!validation.success) {
        const error = this.createStructuredOutputError(validation.failure);

        await this.recordFailedStructuredAttempt(
          operationId,
          attemptNumber,
          fallbackUsed,
          model,
          input,
          providerResult,
          error,
          providerResult.providerLatencyMs,
        );

        return {
          success: false,
          error,
        };
      }

      const result: ValidatedProviderResult = {
        text: validation.text,
        providerResult,
      };

      await this.recordSuccessfulAttempt(
        operationId,
        attemptNumber,
        fallbackUsed,
        model,
        input,
        result,
        providerResult.providerLatencyMs,

        /**
         * Model health is updated by the caller after the complete
         * repair flow succeeds.
         */
        false,
      );

      return {
        success: true,
        result,
      };
    } catch (error: unknown) {
      const normalizedError = this.normalizeError(error);

      await this.recordFailedProviderAttempt(
        operationId,
        attemptNumber,
        fallbackUsed,
        model,
        input,
        normalizedError,
        Date.now() - repairStartedAt,
      );

      return {
        success: false,
        error: normalizedError,
      };
    }
  }

  /**
   * Persists one successful provider request and optionally updates
   * model health.
   */
  private async recordSuccessfulAttempt(
    operationId: string,
    attemptNumber: number,
    fallbackUsed: boolean,
    model: AiModel,
    input: AiExecutionInput,
    result: ValidatedProviderResult,
    responseTimeMs: number,
    updateHealth = true,
  ): Promise<void> {
    const providerKey = this.requireProviderKey(model.providerKey);

    const costEstimate = this.calculateActualCost(
      model,
      result.providerResult.inputTokens,
      result.providerResult.outputTokens,
    );

    const operations: Promise<unknown>[] = [
      this.externalLogService.create({
        operationId,
        attemptNumber,
        fallbackUsed,

        aiModelId: model.id,

        providerKey,

        apiModelId: model.apiModelId,

        requestType: input.requestType,

        userId: input.userId,

        ideaId: input.ideaId,

        requestId: result.providerResult.requestId,

        endpoint: AI_TEXT_GENERATION_ENDPOINT,

        isSuccess: true,

        responseTimeMs,

        inputTokens: result.providerResult.inputTokens,

        outputTokens: result.providerResult.outputTokens,

        costEstimate,
      }),
    ];

    if (updateHealth) {
      operations.push(this.modelHealthService.recordSuccess(model.id));
    }

    /**
     * Logging or health maintenance must not invalidate a provider
     * response that already completed successfully.
     */
    await Promise.allSettled(operations);
  }

  /**
   * Persists a provider response that failed structured-output
   * validation.
   */
  private async recordFailedStructuredAttempt(
    operationId: string,
    attemptNumber: number,
    fallbackUsed: boolean,
    model: AiModel,
    input: AiExecutionInput,

    providerResult: AiProviderGenerateResult,

    error: AiProviderError,
    responseTimeMs: number,
  ): Promise<void> {
    const providerKey = this.requireProviderKey(model.providerKey);

    const costEstimate = this.calculateActualCost(
      model,
      providerResult.inputTokens,
      providerResult.outputTokens,
    );

    await Promise.allSettled([
      this.externalLogService.create({
        operationId,
        attemptNumber,
        fallbackUsed,

        aiModelId: model.id,

        providerKey,

        apiModelId: model.apiModelId,

        requestType: input.requestType,

        userId: input.userId,

        ideaId: input.ideaId,

        requestId: providerResult.requestId,

        endpoint: AI_TEXT_GENERATION_ENDPOINT,

        isSuccess: false,

        responseTimeMs,

        inputTokens: providerResult.inputTokens,

        outputTokens: providerResult.outputTokens,

        costEstimate,

        errorMessage: `[${error.code}] ${error.message}`,
      }),
    ]);
  }

  /**
   * Persists one provider request that failed before producing a usable
   * response.
   */
  private async recordFailedProviderAttempt(
    operationId: string,
    attemptNumber: number,
    fallbackUsed: boolean,
    model: AiModel,
    input: AiExecutionInput,
    error: AiProviderError,
    responseTimeMs: number,
  ): Promise<void> {
    const providerKey = this.requireProviderKey(model.providerKey);

    await Promise.allSettled([
      this.externalLogService.create({
        operationId,
        attemptNumber,
        fallbackUsed,

        aiModelId: model.id,

        providerKey,

        apiModelId: model.apiModelId,

        requestType: input.requestType,

        userId: input.userId,

        ideaId: input.ideaId,

        requestId: error.requestId,

        endpoint: AI_TEXT_GENERATION_ENDPOINT,

        statusCode: error.statusCode,

        isSuccess: false,

        responseTimeMs,

        errorMessage: `[${error.code}] ${error.message}`,
      }),
    ]);
  }

  /**
   * Creates the final successful logical-operation result.
   */
  private buildExecutionResult(
    result: ValidatedProviderResult,
    operationId: string,
    model: AiModel,
    fallbackUsed: boolean,
    attemptCount: number,
    operationStartedAt: number,
  ): AiExecutionResult {
    const providerKey = this.requireProviderKey(model.providerKey);

    const costEstimate = this.calculateActualCost(
      model,
      result.providerResult.inputTokens,
      result.providerResult.outputTokens,
    );

    return {
      text: result.text,

      operationId,

      aiModelId: model.id,

      providerKey,

      apiModelId: model.apiModelId,

      inputTokens: result.providerResult.inputTokens,

      outputTokens: result.providerResult.outputTokens,

      costEstimate,

      responseTimeMs: Date.now() - operationStartedAt,

      finishReason: result.providerResult.finishReason,

      fallbackUsed,

      attemptCount,
    };
  }

  /**
   * Converts structured-output validation issues into a normalized
   * provider error.
   */
  private createStructuredOutputError(
    failure: StructuredOutputValidationFailure,
  ): AiProviderError {
    const issueSummary = failure.issues
      .slice(0, 5)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');

    return new AiProviderError(
      issueSummary
        ? `The AI provider returned invalid structured output. ${issueSummary}`
        : 'The AI provider returned invalid structured output.',

      AiProviderErrorCode.INVALID_STRUCTURED_OUTPUT,

      false,
    );
  }

  /**
   * Validates the complete execution contract before model routing.
   */
  private validateExecutionInput(input: AiExecutionInput): void {
    if (!input.userPrompt.trim()) {
      throw new BadRequestException('userPrompt must not be empty.');
    }

    if (
      input.systemInstruction !== undefined &&
      !input.systemInstruction.trim()
    ) {
      throw new BadRequestException(
        'systemInstruction must not be blank when provided.',
      );
    }

    this.validateOptionalPositiveInteger(
      input.maxOutputTokens,
      'maxOutputTokens',
    );

    this.validateOptionalPositiveInteger(
      input.estimatedOutputTokens,
      'estimatedOutputTokens',
    );

    if (
      input.temperature !== undefined &&
      (!Number.isFinite(input.temperature) ||
        input.temperature < 0 ||
        input.temperature > 2)
    ) {
      throw new BadRequestException(
        'temperature must be a finite number between 0 and 2.',
      );
    }

    if (input.responseFormat !== AiResponseFormat.JSON) {
      if (
        input.responseSchema !== undefined ||
        input.responseSchemaName !== undefined
      ) {
        throw new BadRequestException(
          'responseSchema and responseSchemaName may only be used when responseFormat is JSON.',
        );
      }

      return;
    }

    if (input.responseSchema === undefined) {
      throw new BadRequestException(
        'responseSchema is required when JSON structured output is requested.',
      );
    }

    const responseSchemaName = input.responseSchemaName?.trim();

    if (!responseSchemaName) {
      throw new BadRequestException(
        'responseSchemaName is required when JSON structured output is requested.',
      );
    }

    if (responseSchemaName.length > 100) {
      throw new BadRequestException(
        'responseSchemaName must not exceed 100 characters.',
      );
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(responseSchemaName)) {
      throw new BadRequestException(
        'responseSchemaName must start with a letter and contain only letters, numbers, underscores, or hyphens.',
      );
    }

    if (
      typeof input.responseSchema !== 'object' ||
      input.responseSchema === null ||
      Array.isArray(input.responseSchema)
    ) {
      throw new BadRequestException(
        'responseSchema must be a valid JSON Schema object.',
      );
    }
  }

  /**
   * Resolves the request output-token limit without exceeding the
   * selected model configuration.
   */
  private resolveMaxOutputTokens(
    requestedTokens: number | undefined,

    model: AiModel,
  ): number {
    if (requestedTokens === undefined) {
      return model.maxOutputTokens;
    }

    return Math.min(requestedTokens, model.maxOutputTokens);
  }

  /**
   * Validates and narrows a provider key loaded from the database.
   */
  private requireProviderKey(providerKey: string): AiProviderKey {
    const normalizedProviderKey = normalizeAiProviderKey(providerKey);

    if (!normalizedProviderKey) {
      throw new ServiceUnavailableException(
        `AI model references an unsupported provider: ${providerKey}`,
      );
    }

    return normalizedProviderKey;
  }

  /**
   * Converts unknown exceptions into normalized provider errors.
   */
  private normalizeError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) {
      return error;
    }

    return new AiProviderError(
      error instanceof Error && error.message.trim()
        ? error.message
        : 'Unexpected AI provider error.',

      AiProviderErrorCode.UNKNOWN,

      true,

      undefined,

      undefined,

      error,
    );
  }

  /**
   * Determines whether another routed model may be attempted.
   *
   * Errors caused by the original request itself are not sent to another
   * provider because fallback would reproduce the same invalid request.
   */
  private shouldFallback(error: AiProviderError): boolean {
    const nonFallbackCodes: readonly AiProviderErrorCode[] = [
      AiProviderErrorCode.INVALID_PROMPT,
      AiProviderErrorCode.CANCELLED,
      AiProviderErrorCode.CONTENT_FILTERED,
    ];

    return !nonFallbackCodes.includes(error.code);
  }

  /**
   * Calculates provider cost from reported token usage.
   *
   * The result is rounded to six decimal places to match common
   * Decimal(12, 6) database storage.
   */
  private calculateActualCost(
    model: AiModel,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const inputCost =
      (model.inputCostPerMillion.toNumber() * inputTokens) / 1_000_000;

    const outputCost =
      (model.outputCostPerMillion.toNumber() * outputTokens) / 1_000_000;

    return Number((inputCost + outputCost).toFixed(6));
  }

  /**
   * Produces a pre-request token estimate.
   */
  private estimateTokens(text: string): number {
    return Math.max(
      1,

      Math.ceil(text.length / APPROXIMATE_CHARACTERS_PER_TOKEN),
    );
  }

  /**
   * Calculates exponential retry delay.
   */
  private calculateRetryDelay(failedAttemptNumber: number): number {
    return this.retryBaseDelayMs * 2 ** (failedAttemptNumber - 1);
  }

  /**
   * Waits before the next retry.
   */
  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  /**
   * Validates an optional positive integer request value.
   */
  private validateOptionalPositiveInteger(
    value: number | undefined,
    fieldName: string,
  ): void {
    if (value === undefined) {
      return;
    }

    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${fieldName} must be a positive integer.`);
    }
  }

  /**
   * Reads a bounded positive integer from application configuration.
   */
  private resolveBoundedPositiveIntegerConfig(
    configService: ConfigService,
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const rawValue = configService.get<string | number>(key);

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return fallback;
    }

    const configured = Number(rawValue);

    if (
      !Number.isInteger(configured) ||
      configured < minimum ||
      configured > maximum
    ) {
      return fallback;
    }

    return configured;
  }

  /**
   * Reads a non-negative integer from application configuration.
   */
  private resolveNonNegativeIntegerConfig(
    configService: ConfigService,
    key: string,
    fallback: number,
  ): number {
    const rawValue = configService.get<string | number>(key);

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return fallback;
    }

    const configured = Number(rawValue);

    if (!Number.isInteger(configured) || configured < 0) {
      return fallback;
    }

    return configured;
  }
}
