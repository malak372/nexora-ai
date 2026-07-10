import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiModel, AiModelHealthStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Number of consecutive failures after which a model becomes
 * DEGRADED.
 */
const DEGRADED_FAILURE_THRESHOLD = 2;

/**
 * Number of consecutive failures after which a model becomes
 * UNAVAILABLE.
 */
const UNAVAILABLE_FAILURE_THRESHOLD = 4;

/**
 * Maximum number of attempts used for serializable transactions.
 *
 * Serializable isolation may reject one concurrent transaction
 * to preserve data consistency.
 */
const MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

/**
 * Service responsible for maintaining operational AI-model health.
 *
 * Provider adapters or the central AI execution service should call:
 * - recordSuccess() after a successful provider request.
 * - recordFailure() after a failed provider request.
 *
 * Health fields are internal operational state and must not be
 * modified through administrator DTOs.
 *
 * Health behavior:
 * - A successful request marks the model as HEALTHY.
 * - One isolated failure does not immediately degrade a HEALTHY model.
 * - Two consecutive failures mark the model as DEGRADED.
 * - Four consecutive failures mark the model as UNAVAILABLE.
 * - Any successful request resets the consecutive failure counter.
 *
 * @author Malak
 */
@Injectable()
export class AiModelHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks a model as HEALTHY after a successful provider request.
   *
   * A successful request:
   * - Sets healthStatus to HEALTHY.
   * - Resets consecutiveFailures to zero.
   * - Updates lastHealthCheckAt.
   * - Preserves lastFailureAt for operational history.
   */
  async recordSuccess(modelId: string): Promise<AiModel> {
    try {
      return await this.prisma.aiModel.update({
        where: {
          id: modelId,
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
   * Records one failed provider request and recalculates model health.
   *
   * Serializable isolation prevents concurrent failed requests from
   * reading the same failure counter and overwriting each other.
   *
   * Example:
   * - Request A reads failures = 1.
   * - Request B reads failures = 1.
   * - Without transaction protection, both may save failures = 2.
   *
   * Serializable isolation ensures that all failures are counted.
   */
  async recordFailure(modelId: string): Promise<AiModel> {
    return this.runSerializableTransaction(async (tx) => {
      const model = await tx.aiModel.findUnique({
        where: {
          id: modelId,
        },
      });

      if (!model) {
        throw new NotFoundException('AI model not found.');
      }

      const failures = model.consecutiveFailures + 1;

      const now = new Date();

      return tx.aiModel.update({
        where: {
          id: modelId,
        },

        data: {
          consecutiveFailures: failures,

          healthStatus: this.resolveFailureStatus(model.healthStatus, failures),

          lastHealthCheckAt: now,

          lastFailureAt: now,
        },
      });
    });
  }

  /**
   * Resets operational health statistics.
   *
   * This can be used after:
   * - Administrator provider configuration changes.
   * - Provider recovery.
   * - Manual operational intervention.
   * - A model-health maintenance operation.
   *
   * Resetting health does not:
   * - Activate an inactive model.
   * - Make the model default.
   * - Perform a real provider health check.
   */
  async reset(modelId: string): Promise<AiModel> {
    try {
      return await this.prisma.aiModel.update({
        where: {
          id: modelId,
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
   * Determines model health from its current state and consecutive
   * failure count.
   *
   * Rules:
   * - Four or more failures: UNAVAILABLE.
   * - Two or more failures: DEGRADED.
   * - One failure:
   *   - Preserve HEALTHY when the model was previously healthy.
   *   - Preserve DEGRADED when it was already degraded.
   *   - Preserve UNKNOWN when it has never been proven healthy.
   *
   * A single temporary provider failure is not sufficient evidence
   * to immediately degrade a previously healthy model.
   */
  private resolveFailureStatus(
    currentStatus: AiModelHealthStatus,
    failures: number,
  ): AiModelHealthStatus {
    if (failures >= UNAVAILABLE_FAILURE_THRESHOLD) {
      return AiModelHealthStatus.UNAVAILABLE;
    }

    if (failures >= DEGRADED_FAILURE_THRESHOLD) {
      return AiModelHealthStatus.DEGRADED;
    }

    switch (currentStatus) {
      case AiModelHealthStatus.HEALTHY:
        return AiModelHealthStatus.HEALTHY;

      case AiModelHealthStatus.DEGRADED:
        return AiModelHealthStatus.DEGRADED;

      case AiModelHealthStatus.UNAVAILABLE:
        /*
         * An UNAVAILABLE model normally should not receive new
         * requests because routing excludes it.
         *
         * Preserve its status if recordFailure() is still called.
         */
        return AiModelHealthStatus.UNAVAILABLE;

      case AiModelHealthStatus.UNKNOWN:
        return AiModelHealthStatus.UNKNOWN;

      default:
        return this.assertNever(currentStatus);
    }
  }

  /**
   * Executes a serializable transaction with retry support.
   *
   * Prisma error P2034 indicates a write conflict or transaction
   * failure that may be safely retried.
   */
  private async runSerializableTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        lastError = error;

        const isRetryableConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';

        if (
          !isRetryableConflict ||
          attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS
        ) {
          this.handlePrismaError(error);
        }
      }
    }

    /*
     * This line is theoretically unreachable, but it satisfies
     * strict TypeScript control-flow analysis.
     */
    this.handlePrismaError(lastError);
  }

  /**
   * Ensures every AiModelHealthStatus enum value is handled
   * explicitly.
   *
   * TypeScript will report an error here if a future enum value is
   * added without updating resolveFailureStatus().
   */
  private assertNever(value: never): never {
    throw new Error(`Unsupported AI model health status: ${String(value)}`);
  }

  /**
   * Maps known Prisma errors into safe HTTP exceptions.
   */
  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new NotFoundException('AI model not found.');
      }

      if (error.code === 'P2034') {
        throw new ConflictException(
          'The AI model health was modified concurrently. Please retry.',
        );
      }
    }

    throw error;
  }
}
