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
 * Provider errors that must not trigger model or provider fallback.
 *
 * These errors originate from the caller's request, explicit
 * cancellation, or provider safety filtering. Sending the same request
 * to another model would normally reproduce the same failure or violate
 * the caller's intent.
 */
const NON_FALLBACK_PROVIDER_ERROR_CODES: ReadonlySet<AiProviderErrorCode> =
  new Set([
    AiProviderErrorCode.INVALID_PROMPT,
    AiProviderErrorCode.CANCELLED,
    AiProviderErrorCode.CONTENT_FILTERED,
  ]);

/**
 * Validated response text together with the metadata returned by the
 * provider request that produced it.
 */
type ValidatedProviderResult = {
  /**
   * Final normalized response text.
   *
   * Structured responses contain validated JSON serialized as a string.
   */
  readonly text: string;

  /**
   * Original normalized provider result.
   */
  readonly providerResult: AiProviderGenerateResult;
};

/**
 * Internal provider-request contract.
 *
 * This contract prevents AiExecutionService from passing unrelated
 * business values directly to provider adapters.
 */
type ExecuteProviderRequestInput = {
  /**
   * Prompt submitted as the provider user message.
   */
  readonly userPrompt: string;

  /**
   * Optional provider system-level instruction.
   */
  readonly systemInstruction?: string;

  /**
   * Maximum number of output tokens permitted for this request.
   */
  readonly maxOutputTokens: number;

  /**
   * Optional generation temperature.
   */
  readonly temperature?: number;

  /**
   * Requested high-level response format.
   */
  readonly responseFormat?: AiResponseFormat;

  /**
   * Optional provider-neutral structured-output schema.
   */
  readonly responseSchema?: AiExecutionInput['responseSchema'];

  /**
   * Stable name assigned to the structured-output schema.
   */
  readonly responseSchemaName?: string;
};

/**
 * Mutable execution state shared across all model attempts belonging to
 * one logical AI operation.
 */
type AiExecutionContext = {
  /**
   * Identifier shared by every external request belonging to this
   * logical operation.
   */
  readonly operationId: string;

  /**
   * Timestamp at which the complete logical operation started.
   */
  readonly operationStartedAt: number;

  /**
   * Global number of external provider requests executed so far.
   *
   * Initial requests, retries, repair requests, and fallback requests
   * are all included.
   */
  attemptCount: number;
};

/**
 * Successful result produced by one routed model.
 */
type ModelExecutionSuccess = {
  readonly success: true;
  readonly result: AiExecutionResult;
};

/**
 * Final failure produced by one routed model after exhausting its retry
 * and optional repair flow.
 */
type ModelExecutionFailure = {
  readonly success: false;
  readonly error: AiProviderError;
};

/**
 * Result returned by the execution flow for one routed model.
 */
type ModelExecutionOutcome = ModelExecutionSuccess | ModelExecutionFailure;

/**
 * Result returned by a structured-output repair attempt.
 */
type RepairAttemptOutcome =
  | {
      readonly success: true;
      readonly result: ValidatedProviderResult;
    }
  | {
      readonly success: false;
      readonly error: AiProviderError;
    };

/**
 * Central service responsible for executing logical AI operations.
 *
 * Responsibilities:
 * - Validate the complete execution contract.
 * - Estimate pre-request token usage for routing.
 * - Resolve the ordered list of eligible AI models.
 * - Resolve provider adapters through providerKey.
 * - Apply one cancellable timeout per external request.
 * - Retry temporary failures on the same model.
 * - Validate structured provider output.
 * - Execute one bounded structured-output repair request.
 * - Fall back to another routed model when permitted.
 * - Update persistent model-health information.
 * - Persist one ExternalApiLog record per external request.
 * - Return one provider-neutral logical-operation result.
 *
 * This service intentionally does not:
 * - Build business prompts.
 * - Persist generated ideas.
 * - Deduct credits.
 * - Process payments.
 * - Resolve administrator permissions.
 * - Expose provider-specific SDK responses.
 *
 * @author Malak
 */
@Injectable()
export class AiExecutionService {
  /**
   * Maximum duration of one individual external provider request.
   */
  private readonly timeoutMs: number;

  /**
   * Maximum number of retries after the initial request for one model.
   */
  private readonly maxRetriesPerModel: number;

  /**
   * Base delay used to calculate exponential retry backoff.
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
   * One logical operation may contain several external provider
   * requests because of:
   * - Temporary retries on the same model.
   * - Structured-output repair.
   * - Fallback to another model.
   *
   * @param input Business and execution configuration supplied by the
   * calling module.
   * @returns Final successful provider-neutral AI result.
   * @throws BadRequestException when the execution contract is invalid.
   * @throws AiProviderError when a non-fallback provider failure occurs.
   * @throws ServiceUnavailableException when every routed model fails.
   */
  async execute(input: AiExecutionInput): Promise<AiExecutionResult> {
    this.validateExecutionInput(input);

    const executionContext: AiExecutionContext = {
      operationId: randomUUID(),
      operationStartedAt: Date.now(),
      attemptCount: 0,
    };

    const models = await this.resolveModels(input);

    let lastError: AiProviderError | undefined;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex];
      const fallbackUsed = modelIndex > 0;

      const outcome = await this.executeModel(
        model,
        input,
        executionContext,
        fallbackUsed,
      );

      if (outcome.success) {
        return outcome.result;
      }

      lastError = outcome.error;

      if (!this.shouldFallback(outcome.error)) {
        throw outcome.error;
      }
    }

    throw new ServiceUnavailableException(
      lastError
        ? `All configured AI models failed: ${lastError.message}`
        : 'All configured AI models failed.',
    );
  }

  /**
   * Resolves the ordered list of models eligible to execute one logical
   * operation.
   *
   * Routing receives approximate input and output token counts so
   * cost-aware strategies can compare eligible models before making an
   * external request.
   */
  private async resolveModels(input: AiExecutionInput): Promise<AiModel[]> {
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

    return models;
  }

  /**
   * Executes the complete retry and optional repair flow for one routed
   * model.
   *
   * @param model Routed database model configuration.
   * @param input Logical AI-operation input.
   * @param context Shared logical-operation state.
   * @param fallbackUsed Whether this model is a fallback selection.
   */
  private async executeModel(
    model: AiModel,
    input: AiExecutionInput,
    context: AiExecutionContext,
    fallbackUsed: boolean,
  ): Promise<ModelExecutionOutcome> {
    let provider: AiProvider;

    try {
      provider = this.providerFactory.getProvider(model.providerKey);
    } catch (error: unknown) {
      const normalizedError = this.normalizeError(error);

      await this.recordModelFailure(model.id);

      return {
        success: false,
        error: normalizedError,
      };
    }

    const totalAttemptsForModel = this.maxRetriesPerModel + 1;

    let finalModelError: AiProviderError | undefined;

    for (
      let modelAttemptNumber = 1;
      modelAttemptNumber <= totalAttemptsForModel;
      modelAttemptNumber += 1
    ) {
      const outcome = await this.executeModelAttempt(
        provider,
        model,
        input,
        context,
        fallbackUsed,
        modelAttemptNumber,
        totalAttemptsForModel,
      );

      if (outcome.success) {
        return outcome;
      }

      finalModelError = outcome.error;

      if (!outcome.retrySameModel) {
        break;
      }

      await this.delay(this.calculateRetryDelay(modelAttemptNumber));
    }

    await this.recordModelFailure(model.id);

    return {
      success: false,
      error:
        finalModelError ??
        new AiProviderError(
          'The AI model failed without returning a normalized error.',
          AiProviderErrorCode.UNKNOWN,
          true,
        ),
    };
  }

  /**
   * Executes one initial or retry request against one selected model.
   *
   * A successful provider response is validated immediately. Invalid
   * structured output may trigger one dedicated repair request instead
   * of entering the ordinary temporary-error retry loop.
   */
  private async executeModelAttempt(
    provider: AiProvider,
    model: AiModel,
    input: AiExecutionInput,
    context: AiExecutionContext,
    fallbackUsed: boolean,
    modelAttemptNumber: number,
    totalAttemptsForModel: number,
  ): Promise<
    | ModelExecutionSuccess
    | {
        readonly success: false;
        readonly error: AiProviderError;
        readonly retrySameModel: boolean;
      }
  > {
    const attemptNumber = this.incrementAttemptCount(context);
    const attemptStartedAt = Date.now();

    try {
      const providerResult = await this.executeProviderRequest(
        provider,
        model,
        this.buildOriginalProviderRequest(input, model),
      );

      this.validateProviderMetadata(provider, model, providerResult);

      const validation = this.validateProviderResult(providerResult, input);

      if (validation.success) {
        const successfulResult: ValidatedProviderResult = {
          text: validation.text,
          providerResult,
        };

        await this.recordSuccessfulAttempt(
          context.operationId,
          attemptNumber,
          fallbackUsed,
          model,
          input,
          successfulResult,
          providerResult.providerLatencyMs,
        );

        return {
          success: true,
          result: this.buildExecutionResult(
            successfulResult,
            context,
            model,
            fallbackUsed,
          ),
        };
      }

      const invalidOutputError = this.createStructuredOutputError(
        validation.failure,
      );

      await this.recordFailedStructuredAttempt(
        context.operationId,
        attemptNumber,
        fallbackUsed,
        model,
        input,
        providerResult,
        invalidOutputError,
        providerResult.providerLatencyMs,
      );

      const repairOutcome = await this.tryRepairStructuredOutput(
        provider,
        model,
        input,
        providerResult.text,
        validation.failure,
        context,
        fallbackUsed,
      );

      if (repairOutcome?.success) {
        await this.recordModelSuccess(model.id);

        return {
          success: true,
          result: this.buildExecutionResult(
            repairOutcome.result,
            context,
            model,
            fallbackUsed,
          ),
        };
      }

      return {
        success: false,
        error: repairOutcome?.error ?? invalidOutputError,

        /**
         * Invalid structured output is handled by the dedicated repair
         * flow and must not enter the ordinary provider retry loop.
         */
        retrySameModel: false,
      };
    } catch (error: unknown) {
      const normalizedError = this.normalizeError(error);

      await this.recordFailedProviderAttempt(
        context.operationId,
        attemptNumber,
        fallbackUsed,
        model,
        input,
        normalizedError,
        Date.now() - attemptStartedAt,
      );

      const hasAnotherAttempt =
        modelAttemptNumber < totalAttemptsForModel;

      return {
        success: false,
        error: normalizedError,
        retrySameModel: normalizedError.retryable && hasAnotherAttempt,
      };
    }
  }

  /**
   * Builds the provider request used by the original logical operation.
   */
  private buildOriginalProviderRequest(
    input: AiExecutionInput,
    model: AiModel,
  ): ExecuteProviderRequestInput {
    return {
      userPrompt: input.userPrompt,

      systemInstruction: input.systemInstruction,

      maxOutputTokens: this.resolveMaxOutputTokens(
        input.maxOutputTokens,
        model,
      ),

      temperature: input.temperature,

      responseFormat: input.responseFormat,

      /**
       * Provider adapters that support native structured output may use
       * these values. Central validation remains mandatory.
       */
      responseSchema: input.responseSchema,

      responseSchemaName: input.responseSchemaName,
    };
  }

  /**
   * Executes one provider request with an independent cancellable
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
   * Verifies that the adapter, routed model, and provider response refer
   * to the same provider and external model identifiers.
   *
   * This protects logs and returned metadata from incorrectly
   * implemented provider adapters.
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
   * Validates one provider response according to the requested response
   * format.
   *
   * Plain-text responses are accepted directly. JSON responses are
   * parsed and validated centrally using the caller-supplied schema.
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
     * The discriminated AiExecutionInput union and runtime validation
     * guarantee that these values are available for JSON operations.
     */
    const responseSchema = input.responseSchema;
    const responseSchemaName = input.responseSchemaName.trim();

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
       * Return normalized validated JSON without Markdown fences,
       * provider commentary, or unsupported surrounding text.
       */
      text: JSON.stringify(validation.data),
    };
  }

  /**
   * Executes a structured-output repair request when repair is enabled.
   *
   * @returns null when structured-output repair is disabled.
   */
  private async tryRepairStructuredOutput(
    provider: AiProvider,
    model: AiModel,
    input: AiExecutionInput,
    invalidResponse: string,
    validationFailure: StructuredOutputValidationFailure,
    context: AiExecutionContext,
    fallbackUsed: boolean,
  ): Promise<RepairAttemptOutcome | null> {
    if (MAX_AI_STRUCTURED_OUTPUT_REPAIRS <= 0) {
      return null;
    }

    const repairAttemptNumber = this.incrementAttemptCount(context);

    return this.executeRepairAttempt(
      provider,
      model,
      input,
      invalidResponse,
      validationFailure,
      context.operationId,
      repairAttemptNumber,
      fallbackUsed,
    );
  }

  /**
   * Executes one bounded structured-output repair request.
   *
   * The repair uses the same model and response schema as the original
   * request, but replaces the original prompt with a dedicated repair
   * instruction and uses a stable low temperature.
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
  ): Promise<RepairAttemptOutcome> {
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
           * Repair must target the exact same structured-output contract
           * as the original operation.
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
         * Model health is updated by the model flow only after the
         * complete repair flow succeeds.
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
   * Persists one successful provider request and optionally records
   * model-health success.
   *
   * Logging or health-update failures must not invalidate a provider
   * response that has already completed successfully.
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

    const maintenanceOperations: Promise<unknown>[] = [
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
      maintenanceOperations.push(
        this.modelHealthService.recordSuccess(model.id),
      );
    }

    await Promise.allSettled(maintenanceOperations);
  }

  /**
   * Persists a provider response that completed externally but failed
   * application-level structured-output validation.
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

    await this.ignoreMaintenanceFailure(
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
    );
  }

  /**
   * Persists one provider request that failed before producing a usable
   * provider result.
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

    await this.ignoreMaintenanceFailure(
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
    );
  }

  /**
   * Records one successful completed model flow without allowing a
   * maintenance failure to invalidate the generated response.
   */
  private async recordModelSuccess(modelId: string): Promise<void> {
    await this.ignoreMaintenanceFailure(
      this.modelHealthService.recordSuccess(modelId),
    );
  }

  /**
   * Records one failed completed model flow without replacing the
   * provider error returned by that model.
   */
  private async recordModelFailure(modelId: string): Promise<void> {
    await this.ignoreMaintenanceFailure(
      this.modelHealthService.recordFailure(modelId),
    );
  }

  /**
   * Awaits a non-critical logging or health-maintenance operation and
   * intentionally suppresses its failure.
   *
   * External provider execution is the primary operation. A secondary
   * logging or health-update failure must not replace an already known
   * provider result.
   */
  private async ignoreMaintenanceFailure(
    operation: Promise<unknown>,
  ): Promise<void> {
    try {
      await operation;
    } catch {
      /**
       * Intentionally ignored.
       *
       * The underlying logging or health service should report its own
       * internal failure when operational diagnostics are required.
       */
    }
  }

  /**
   * Creates the final successful logical-operation result.
   */
  private buildExecutionResult(
    result: ValidatedProviderResult,
    context: AiExecutionContext,
    model: AiModel,
    fallbackUsed: boolean,
  ): AiExecutionResult {
    const providerKey = this.requireProviderKey(model.providerKey);

    const costEstimate = this.calculateActualCost(
      model,
      result.providerResult.inputTokens,
      result.providerResult.outputTokens,
    );

    return {
      text: result.text,

      operationId: context.operationId,

      aiModelId: model.id,

      providerKey,

      apiModelId: model.apiModelId,

      inputTokens: result.providerResult.inputTokens,

      outputTokens: result.providerResult.outputTokens,

      costEstimate,

      responseTimeMs: Date.now() - context.operationStartedAt,

      finishReason: result.providerResult.finishReason,

      fallbackUsed,

      attemptCount: context.attemptCount,
    };
  }

  /**
   * Converts structured-output validation issues into one normalized
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
   * Validates the complete logical execution contract before routing any
   * model or sending an external request.
   */
  private validateExecutionInput(input: AiExecutionInput): void {
    this.validatePromptFields(input);

    this.validateGenerationOptions(input);

    this.validateResponseConfiguration(input);
  }

  /**
   * Validates user and system prompt values.
   */
  private validatePromptFields(input: AiExecutionInput): void {
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
  }

  /**
   * Validates optional generation limits and routing estimates.
   */
  private validateGenerationOptions(input: AiExecutionInput): void {
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
  }

  /**
   * Validates plain-text or structured-output configuration.
   */
  private validateResponseConfiguration(input: AiExecutionInput): void {
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

    this.validateJsonResponseConfiguration(input);
  }

  /**
   * Validates fields required for JSON structured-output execution.
   */
  private validateJsonResponseConfiguration(
    input: Extract<
      AiExecutionInput,
      { readonly responseFormat: AiResponseFormat.JSON }
    >,
  ): void {
    if (
      typeof input.responseSchema !== 'object' ||
      input.responseSchema === null ||
      Array.isArray(input.responseSchema)
    ) {
      throw new BadRequestException(
        'responseSchema must be a valid JSON Schema object.',
      );
    }

    this.validateResponseSchemaName(input.responseSchemaName);
  }

  /**
   * Validates the stable name assigned to a structured-output schema.
   */
  private validateResponseSchemaName(responseSchemaName: string): void {
    const normalizedName = responseSchemaName.trim();

    if (!normalizedName) {
      throw new BadRequestException(
        'responseSchemaName is required when JSON structured output is requested.',
      );
    }

    if (normalizedName.length > 100) {
      throw new BadRequestException(
        'responseSchemaName must not exceed 100 characters.',
      );
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(normalizedName)) {
      throw new BadRequestException(
        'responseSchemaName must start with a letter and contain only letters, numbers, underscores, or hyphens.',
      );
    }
  }

  /**
   * Resolves the provider output-token limit without exceeding the
   * selected model's configured maximum.
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
   * Validates and narrows a provider key loaded from Prisma.
   *
   * Prisma persists providerKey as a string because the provider
   * registry is maintained in application code rather than as a
   * database enum or provider table.
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
   * Converts an unknown thrown value into a provider-neutral error.
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
   * Determines whether execution may continue with another routed model.
   */
  private shouldFallback(error: AiProviderError): boolean {
    return !NON_FALLBACK_PROVIDER_ERROR_CODES.has(error.code);
  }

  /**
   * Calculates provider cost from reported input and output token usage.
   *
   * The result is rounded to six decimal places to match common
   * Decimal(12, 6) database storage.
   *
   * When a provider reports zero because usage metadata is unavailable,
   * the calculated estimate is also zero.
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
   * Produces an approximate pre-request token count using text length.
   *
   * This estimate is intended only for model routing and preliminary
   * cost comparison. It must not be used as billing-accurate token
   * usage.
   */
  private estimateTokens(text: string): number {
    return Math.max(
      1,
      Math.ceil(text.length / APPROXIMATE_CHARACTERS_PER_TOKEN),
    );
  }

  /**
   * Increments and returns the global external-request number belonging
   * to one logical operation.
   */
  private incrementAttemptCount(context: AiExecutionContext): number {
    context.attemptCount += 1;

    return context.attemptCount;
  }

  /**
   * Calculates exponential retry delay after one failed model attempt.
   */
  private calculateRetryDelay(failedAttemptNumber: number): number {
    return this.retryBaseDelayMs * 2 ** (failedAttemptNumber - 1);
  }

  /**
   * Waits before executing the next retry against the same model.
   */
  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  /**
   * Validates an optional positive integer supplied by the caller.
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
   *
   * Missing or invalid values fall back to the supplied safe default.
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

    const configuredValue = Number(rawValue);

    if (
      !Number.isInteger(configuredValue) ||
      configuredValue < minimum ||
      configuredValue > maximum
    ) {
      return fallback;
    }

    return configuredValue;
  }

  /**
   * Reads a non-negative integer from application configuration.
   *
   * Missing or invalid values fall back to the supplied safe default.
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

    const configuredValue = Number(rawValue);

    if (!Number.isInteger(configuredValue) || configuredValue < 0) {
      return fallback;
    }

    return configuredValue;
  }
}