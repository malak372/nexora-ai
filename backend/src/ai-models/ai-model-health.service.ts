import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AiModel, AiModelHealthStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import {
  AI_MODEL_DEGRADED_FAILURE_THRESHOLD,
  AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS,
  AI_MODEL_UNAVAILABLE_FAILURE_THRESHOLD,
} from './constants/ai-model-health.constants';

/**
 * Maintains operational model health.
 *
 * The central execution service should call recordSuccess() or
 * recordFailure() after one logical model execution.
 *
 * @author Malak
 */
@Injectable()
export class AiModelHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marks a model as healthy and resets its failure counter.
   */
  async recordSuccess(modelId: string): Promise<AiModel> {
    const id = this.requireIdentifier(modelId, 'AI model ID');

    try {
      return await this.prisma.aiModel.update({
        where: { id },

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
   * Records one failed logical execution.
   */
  async recordFailure(modelId: string): Promise<AiModel> {
    const id = this.requireIdentifier(modelId, 'AI model ID');

    return this.runSerializableTransaction(async (tx) => {
      const model = await tx.aiModel.findUnique({
        where: { id },
      });

      if (!model) {
        throw new NotFoundException('AI model not found.');
      }

      const failures = model.consecutiveFailures + 1;

      const now = new Date();

      return tx.aiModel.update({
        where: { id },

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
   * Resets health to UNKNOWN.
   */
  async reset(modelId: string): Promise<AiModel> {
    const id = this.requireIdentifier(modelId, 'AI model ID');

    try {
      return await this.prisma.aiModel.update({
        where: { id },

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

  private resolveFailureStatus(
    currentStatus: AiModelHealthStatus,
    failures: number,
  ): AiModelHealthStatus {
    if (failures >= AI_MODEL_UNAVAILABLE_FAILURE_THRESHOLD) {
      return AiModelHealthStatus.UNAVAILABLE;
    }

    if (failures >= AI_MODEL_DEGRADED_FAILURE_THRESHOLD) {
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

        if (
          !retryable ||
          attempt === AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS
        ) {
          this.handlePrismaError(error);
        }
      }
    }

    this.handlePrismaError(lastError);
  }

  private requireIdentifier(value: string, fieldName: string): string {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} is required.`);
    }

    return normalizedValue;
  }

  private assertNever(value: never): never {
    throw new Error(`Unsupported AI model health status: ${String(value)}`);
  }

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
