import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AiModelHealthStatus, Prisma } from '@prisma/client';

import type { AiModel } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  AI_MODEL_DEGRADED_FAILURE_THRESHOLD,
  AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS,
  AI_MODEL_UNAVAILABLE_FAILURE_THRESHOLD,
} from './constants/ai-model-health.constants';

/**
 * Service responsible for maintaining the operational health state of
 * configured AI models.
 *
 * AiExecutionService should call:
 * - recordSuccess() after one successful logical model execution.
 * - recordFailure() after one failed logical model execution.
 *
 * A logical execution represents the complete attempt for a selected
 * model, not every low-level retry performed against the same provider.
 *
 * Health-transition rules:
 * - A successful execution marks the model as HEALTHY and resets its
 *   consecutive-failure counter.
 * - Two consecutive failures mark the model as DEGRADED.
 * - Four consecutive failures mark the model as UNAVAILABLE.
 * - A manual reset returns the model to UNKNOWN.
 *
 * Serializable transactions are used when recording failures to prevent
 * concurrent executions from overwriting each other's failure-counter
 * updates.
 *
 * @author Malak
 */
@Injectable()
export class AiModelHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one successful logical model execution.
   *
   * The model is marked as HEALTHY, its consecutive-failure counter is
   * reset, and the latest health-check timestamp is updated.
   *
   * lastFailureAt is intentionally preserved because it represents the
   * historical time of the most recent failure, even after the model
   * becomes healthy again.
   *
   * @param modelId Identifier of the successfully executed AI model.
   * @returns Updated AI-model record.
   *
   * @throws BadRequestException When modelId is blank.
   * @throws NotFoundException When the model does not exist.
   */
  async recordSuccess(modelId: string): Promise<AiModel> {
    const id = this.requireIdentifier(modelId, 'AI model ID');

    try {
      return await this.prisma.aiModel.update({
        where: {
          id,
        },

        data: {
          healthStatus: AiModelHealthStatus.HEALTHY,

          consecutiveFailures: 0,

          lastHealthCheckAt: new Date(),
        },
      });
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Records one failed logical model execution.
   *
   * The failure counter is incremented atomically inside a serializable
   * database transaction. The model's next health status is then
   * calculated from the updated number of consecutive failures.
   *
   * Health thresholds:
   * - Below the degraded threshold: preserve the current status.
   * - At or above the degraded threshold: DEGRADED.
   * - At or above the unavailable threshold: UNAVAILABLE.
   *
   * Both lastHealthCheckAt and lastFailureAt are updated to the current
   * time.
   *
   * @param modelId Identifier of the failed AI model.
   * @returns Updated AI-model record.
   *
   * @throws BadRequestException When modelId is blank.
   * @throws NotFoundException When the model does not exist.
   * @throws ConflictException When repeated transaction conflicts
   * prevent the health update from completing.
   */
  async recordFailure(modelId: string): Promise<AiModel> {
    const id = this.requireIdentifier(modelId, 'AI model ID');

    return this.runSerializableTransaction(async (tx) => {
      const model = await tx.aiModel.findUnique({
        where: {
          id,
        },
      });

      if (!model) {
        throw new NotFoundException('AI model not found.');
      }

      const consecutiveFailures = model.consecutiveFailures + 1;

      const now = new Date();

      return tx.aiModel.update({
        where: {
          id,
        },

        data: {
          consecutiveFailures,

          healthStatus: this.resolveFailureStatus(
            model.healthStatus,
            consecutiveFailures,
          ),

          lastHealthCheckAt: now,

          lastFailureAt: now,
        },
      });
    });
  }

  /**
   * Resets one model's operational health state.
   *
   * The model is returned to UNKNOWN so that future provider executions
   * can determine its current health again.
   *
   * This operation clears:
   * - The consecutive-failure counter.
   * - The latest health-check timestamp.
   * - The latest failure timestamp.
   *
   * @param modelId Identifier of the AI model being reset.
   * @returns Updated AI-model record.
   *
   * @throws BadRequestException When modelId is blank.
   * @throws NotFoundException When the model does not exist.
   */
  async reset(modelId: string): Promise<AiModel> {
    const id = this.requireIdentifier(modelId, 'AI model ID');

    try {
      return await this.prisma.aiModel.update({
        where: {
          id,
        },

        data: {
          healthStatus: AiModelHealthStatus.UNKNOWN,

          consecutiveFailures: 0,

          lastHealthCheckAt: null,

          lastFailureAt: null,
        },
      });
    } catch (error: unknown) {
      this.handlePrismaError(error);
    }
  }

  /**
   * Resolves the health status that should be assigned after a failed
   * logical model execution.
   *
   * The UNAVAILABLE threshold is evaluated before the DEGRADED
   * threshold because every unavailable failure count also satisfies
   * the degraded threshold.
   *
   * When the failure count has not yet reached either threshold, the
   * model preserves its current status.
   *
   * Examples with the current thresholds:
   * - First failure: preserves the current status.
   * - Second and third failures: DEGRADED.
   * - Fourth and later failures: UNAVAILABLE.
   *
   * @param currentStatus Current persisted model health status.
   * @param consecutiveFailures Updated consecutive-failure count.
   * @returns Health status that should be persisted.
   */
  private resolveFailureStatus(
    currentStatus: AiModelHealthStatus,
    consecutiveFailures: number,
  ): AiModelHealthStatus {
    if (consecutiveFailures >= AI_MODEL_UNAVAILABLE_FAILURE_THRESHOLD) {
      return AiModelHealthStatus.UNAVAILABLE;
    }

    if (consecutiveFailures >= AI_MODEL_DEGRADED_FAILURE_THRESHOLD) {
      return AiModelHealthStatus.DEGRADED;
    }

    switch (currentStatus) {
      case AiModelHealthStatus.HEALTHY:
        return AiModelHealthStatus.HEALTHY;

      case AiModelHealthStatus.DEGRADED:
        return AiModelHealthStatus.DEGRADED;

      case AiModelHealthStatus.UNAVAILABLE:
        return AiModelHealthStatus.UNAVAILABLE;

      case AiModelHealthStatus.UNKNOWN:
        return AiModelHealthStatus.UNKNOWN;

      default:
        return this.assertNever(currentStatus);
    }
  }

  /**
   * Executes a database operation in a serializable transaction.
   *
   * Prisma error P2034 indicates a transaction conflict or deadlock.
   * Such failures are retried up to the configured maximum number of
   * attempts.
   *
   * Non-retryable database errors are mapped immediately to safe HTTP
   * exceptions.
   *
   * @typeParam T Result returned by the transaction operation.
   * @param operation Function executed inside the Prisma transaction.
   * @returns Result produced by the successful transaction.
   *
   * @throws ConflictException When all retry attempts fail because of
   * concurrent database modifications.
   */
  private async runSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        lastError = error;

        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';

        const finalAttempt =
          attempt === AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS;

        if (!retryable || finalAttempt) {
          this.handlePrismaError(error);
        }
      }
    }

    /*
     * This statement is theoretically unreachable because the final
     * failed attempt is handled inside the loop. It remains as a safe
     * exhaustiveness guard for future control-flow changes.
     */
    this.handlePrismaError(lastError);
  }

  /**
   * Validates and normalizes one required identifier.
   *
   * @param value Raw identifier supplied by the caller.
   * @param fieldName Human-readable field name used in validation
   * errors.
   * @returns Trimmed non-empty identifier.
   *
   * @throws BadRequestException When the supplied identifier is blank.
   */
  private requireIdentifier(value: string, fieldName: string): string {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} is required.`);
    }

    return normalizedValue;
  }

  /**
   * Provides an exhaustive runtime guard for AiModelHealthStatus.
   *
   * TypeScript reports a compile-time error when a new enum value is
   * introduced without being handled by resolveFailureStatus().
   *
   * @param value Unhandled enum value.
   * @throws Error Always.
   */
  private assertNever(value: never): never {
    throw new Error(`Unsupported AI model health status: ${String(value)}`);
  }

  /**
   * Maps known Prisma errors to safe application-level HTTP
   * exceptions.
   *
   * Supported mappings:
   * - P2025: AI model was not found.
   * - P2034: Serializable transaction conflict.
   *
   * Unknown errors are rethrown unchanged so NestJS exception handling
   * and application logging can process them normally.
   *
   * @param error Error raised by Prisma or another dependency.
   * @throws NotFoundException For Prisma P2025.
   * @throws ConflictException For Prisma P2034.
   */
  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new NotFoundException('AI model not found.');
      }

      if (error.code === 'P2034') {
        throw new ConflictException(
          'AI model health was modified concurrently. Please retry.',
        );
      }
    }

    throw error;
  }
}
