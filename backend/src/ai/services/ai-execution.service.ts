import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModel, AiRoutingStrategy, PromptType } from '@prisma/client';
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
  MAX_AI_STRUCTURED_OUTPUT_REPAIRS,
} from '../constants';

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

type ValidatedProviderResult = {
  readonly text: string;
  readonly providerResult: AiProviderGenerateResult;
};

/**
 * Central service responsible for executing logical AI operations.
 *
 * @author Malak
 */
@Injectable()
export class AiExecutionService {
  private readonly timeoutMs: number;

  private readonly maxRetriesPerModel: number;

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
    this.timeoutMs = this.resolvePositiveIntegerConfig(
      configService,
      'AI_REQUEST_TIMEOUT_MS',
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
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

      const provider = this.providerFactory.getProvider(model.provider);

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
            },
          );

          const validation = this.validateProviderResult(providerResult, input);

          if (validation.success) {
            const successfulResult = {
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
              Date.now() - attemptStartedAt,
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
            Date.now() - attemptStartedAt,
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

  private executeProviderRequest(
    provider: AiProvider,
    model: AiModel,
    request: {
      readonly userPrompt: string;
      readonly systemInstruction?: string;
      readonly maxOutputTokens: number;
      readonly temperature?: number;
      readonly responseFormat?: AiResponseFormat;
    },
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
          signal,
        }),
      this.timeoutMs,
    );
  }

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

    const validation = this.structuredOutputService.safeValidateIdeaOutput(
      providerResult.text,
      input.generationType,
      input.promptType!,
    );

    if (!validation.success) {
      return {
        success: false,
        failure: validation,
      };
    }

    return {
      success: true,
      text: JSON.stringify(validation.data),
    };
  }

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
        },
      );

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
          Date.now() - repairStartedAt,
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
        Date.now() - repairStartedAt,
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
        provider: model.provider,
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

    await Promise.allSettled(operations);
  }

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
        provider: model.provider,
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

  private async recordFailedProviderAttempt(
    operationId: string,
    attemptNumber: number,
    fallbackUsed: boolean,
    model: AiModel,
    input: AiExecutionInput,
    error: AiProviderError,
    responseTimeMs: number,
  ): Promise<void> {
    await Promise.allSettled([
      this.externalLogService.create({
        operationId,
        attemptNumber,
        fallbackUsed,
        aiModelId: model.id,
        provider: model.provider,
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

  private buildExecutionResult(
    result: ValidatedProviderResult,
    operationId: string,
    model: AiModel,
    fallbackUsed: boolean,
    attemptCount: number,
    operationStartedAt: number,
  ): AiExecutionResult {
    const costEstimate = this.calculateActualCost(
      model,
      result.providerResult.inputTokens,
      result.providerResult.outputTokens,
    );

    return {
      text: result.text,
      operationId,
      aiModelId: model.id,
      provider: model.provider,
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

  private validateExecutionInput(input: AiExecutionInput): void {
    if (input.responseFormat !== AiResponseFormat.JSON) {
      return;
    }

    if (input.promptType === undefined) {
      throw new BadRequestException(
        'promptType is required when JSON structured output is requested.',
      );
    }

    if (
      input.promptType !== PromptType.IDEA_GENERATION &&
      input.promptType !== PromptType.IDEA_UNLOCK
    ) {
      throw new BadRequestException(
        `Structured idea output is not supported for prompt type ${input.promptType}.`,
      );
    }

    if (
      input.promptType === PromptType.IDEA_GENERATION &&
      input.generationType === undefined
    ) {
      throw new BadRequestException(
        'generationType is required for structured idea generation.',
      );
    }
  }

  private resolveMaxOutputTokens(
    requestedTokens: number | undefined,
    model: AiModel,
  ): number {
    if (requestedTokens === undefined) {
      return model.maxOutputTokens;
    }

    return Math.min(requestedTokens, model.maxOutputTokens);
  }

  private normalizeError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) {
      return error;
    }

    return new AiProviderError(
      error instanceof Error ? error.message : 'Unexpected AI provider error.',
      AiProviderErrorCode.UNKNOWN,
      true,
      undefined,
      undefined,
      error,
    );
  }

  /**
   * Determines whether execution may continue with another candidate
   * model.
   *
   * Insufficient quota is permanent for the current provider account,
   * but fallback to another configured provider is permitted.
   */
  private shouldFallback(error: AiProviderError): boolean {
    switch (error.code) {
      case AiProviderErrorCode.INVALID_PROMPT:
      case AiProviderErrorCode.CANCELLED:
      case AiProviderErrorCode.CONTENT_FILTERED:
        return false;

      case AiProviderErrorCode.TIMEOUT:
      case AiProviderErrorCode.NETWORK:
      case AiProviderErrorCode.RATE_LIMIT:
      case AiProviderErrorCode.INSUFFICIENT_QUOTA:
      case AiProviderErrorCode.PROVIDER_UNAVAILABLE:
      case AiProviderErrorCode.INVALID_CREDENTIALS:
      case AiProviderErrorCode.FORBIDDEN:
      case AiProviderErrorCode.MODEL_NOT_FOUND:
      case AiProviderErrorCode.INVALID_MODEL_CONFIGURATION:
      case AiProviderErrorCode.EMPTY_RESPONSE:
      case AiProviderErrorCode.INVALID_STRUCTURED_OUTPUT:
      case AiProviderErrorCode.UNKNOWN:
        return true;

      default:
        return this.assertNeverErrorCode(error.code);
    }
  }

  private calculateActualCost(
    model: AiModel,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const inputCost =
      (model.inputCostPerMillion.toNumber() * inputTokens) / 1_000_000;

    const outputCost =
      (model.outputCostPerMillion.toNumber() * outputTokens) / 1_000_000;

    return inputCost + outputCost;
  }

  private estimateTokens(text: string): number {
    return Math.max(
      1,
      Math.ceil(text.length / APPROXIMATE_CHARACTERS_PER_TOKEN),
    );
  }

  private calculateRetryDelay(failedAttemptNumber: number): number {
    return this.retryBaseDelayMs * 2 ** (failedAttemptNumber - 1);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  private resolvePositiveIntegerConfig(
    configService: ConfigService,
    key: string,
    fallback: number,
  ): number {
    const configured = Number(configService.get<string | number>(key));

    if (!Number.isInteger(configured) || configured <= 0) {
      return fallback;
    }

    return configured;
  }

  private resolveNonNegativeIntegerConfig(
    configService: ConfigService,
    key: string,
    fallback: number,
  ): number {
    const configured = Number(configService.get<string | number>(key));

    if (!Number.isInteger(configured) || configured < 0) {
      return fallback;
    }

    return configured;
  }

  private assertNeverErrorCode(value: never): never {
    throw new Error(`Unsupported AI provider error code: ${String(value)}.`);
  }
}
