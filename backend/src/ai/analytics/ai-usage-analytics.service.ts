import { BadRequestException, Injectable } from '@nestjs/common';

import { ExternalServiceCategory, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { GetAiAnalyticsQueryDto } from './dto/get-ai-analytics-query.dto';

import type { AiUsageAnalyticsSummary } from './types/ai-usage-analytics.type';

/**
 * Per-model usage aggregation configuration.
 *
 * Defining the aggregation shape with Prisma.validator preserves the
 * exact inferred groupBy result type.
 */
const AI_USAGE_BY_MODEL_GROUP_ARGS =
  Prisma.validator<Prisma.ExternalApiLogGroupByArgs>()({
    by: ['aiModelId'],

    orderBy: {
      aiModelId: Prisma.SortOrder.asc,
    },

    _count: {
      _all: true,
    },

    _sum: {
      inputTokens: true,
      outputTokens: true,
      costEstimate: true,
    },

    _avg: {
      responseTimeMs: true,
    },
  });

/**
 * Per-model successful-request aggregation configuration.
 */
const AI_SUCCESS_BY_MODEL_GROUP_ARGS =
  Prisma.validator<Prisma.ExternalApiLogGroupByArgs>()({
    by: ['aiModelId'],

    orderBy: {
      aiModelId: Prisma.SortOrder.asc,
    },

    _count: {
      _all: true,
    },
  });

/**
 * Provides aggregated analytics for individual external AI-provider
 * attempts.
 *
 * Only ExternalApiLog records belonging to
 * ExternalServiceCategory.AI are included.
 *
 * Payment, data-collection, and other external service logs are
 * intentionally excluded.
 *
 * @author Malak
 */
@Injectable()
export class AiUsageAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns administrator-facing AI usage analytics.
   *
   * Counts represent individual provider attempts, including:
   * - Initial requests.
   * - Retries.
   * - Structured-output repair attempts.
   * - Fallback requests.
   */
  async getSummary(
    query: GetAiAnalyticsQueryDto,
  ): Promise<AiUsageAnalyticsSummary> {
    const where = this.buildWhere(query);

    const [
      totalRequests,
      successfulRequests,
      fallbackAttempts,
      aggregates,
      byModel,
      successfulByModel,
    ] = await this.prisma.$transaction([
      /**
       * Total matching external AI attempts.
       */
      this.prisma.externalApiLog.count({
        where,
      }),

      /**
       * Successful matching attempts.
       */
      this.prisma.externalApiLog.count({
        where: {
          ...where,
          isSuccess: true,
        },
      }),

      /**
       * Attempts made using a fallback model.
       */
      this.prisma.externalApiLog.count({
        where: {
          ...where,
          fallbackUsed: true,
        },
      }),

      /**
       * Overall token, cost, and latency aggregates.
       */
      this.prisma.externalApiLog.aggregate({
        where,

        _sum: {
          inputTokens: true,
          outputTokens: true,
          costEstimate: true,
        },

        _avg: {
          responseTimeMs: true,
        },
      }),

      /**
       * Usage grouped by AI-model relation.
       */
      this.prisma.externalApiLog.groupBy({
        ...AI_USAGE_BY_MODEL_GROUP_ARGS,
        where,
      }),

      /**
       * Successful-attempt counts grouped by AI model.
       */
      this.prisma.externalApiLog.groupBy({
        ...AI_SUCCESS_BY_MODEL_GROUP_ARGS,

        where: {
          ...where,
          isSuccess: true,
        },
      }),
    ]);

    /**
     * Remove null model identifiers and duplicate IDs before loading
     * model metadata.
     */
    const modelIds = [
      ...new Set(
        byModel
          .map((item) => item.aiModelId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const models =
      modelIds.length === 0
        ? []
        : await this.prisma.aiModel.findMany({
            where: {
              id: {
                in: modelIds,
              },
            },

            select: {
              id: true,
              providerKey: true,
              modelName: true,
              apiModelId: true,
            },
          });

    const modelMap = new Map(models.map((model) => [model.id, model]));

    const successCountMap = new Map<string | null, number>(
      successfulByModel.map((item) => [item.aiModelId, item._count._all]),
    );

    return {
      totalRequests,

      successfulRequests,

      failedRequests: totalRequests - successfulRequests,

      successRate: this.calculatePercentage(successfulRequests, totalRequests),

      averageResponseTimeMs: this.toRoundedNumber(
        aggregates._avg.responseTimeMs,
      ),

      totalInputTokens: aggregates._sum.inputTokens ?? 0,

      totalOutputTokens: aggregates._sum.outputTokens ?? 0,

      totalCost: this.toRoundedNumber(aggregates._sum.costEstimate, 6),

      fallbackAttempts,

      models: byModel.map((item) => {
        const requests = item._count._all;

        const successfulModelRequests =
          successCountMap.get(item.aiModelId) ?? 0;

        return {
          aiModelId: item.aiModelId,

          model:
            item.aiModelId === null
              ? null
              : (modelMap.get(item.aiModelId) ?? null),

          requests,

          successfulRequests: successfulModelRequests,

          failedRequests: requests - successfulModelRequests,

          inputTokens: item._sum.inputTokens ?? 0,

          outputTokens: item._sum.outputTokens ?? 0,

          cost: this.toRoundedNumber(item._sum.costEstimate, 6),

          averageResponseTimeMs: this.toRoundedNumber(item._avg.responseTimeMs),
        };
      }),
    };
  }

  /**
   * Builds the ExternalApiLog query filter.
   */
  private buildWhere(
    query: GetAiAnalyticsQueryDto,
  ): Prisma.ExternalApiLogWhereInput {
    const fromDate = query.fromDate
      ? this.parseStartDate(query.fromDate)
      : undefined;

    const toDate = query.toDate ? this.parseEndDate(query.toDate) : undefined;

    if (
      fromDate !== undefined &&
      toDate !== undefined &&
      fromDate.getTime() > toDate.getTime()
    ) {
      throw new BadRequestException(
        'fromDate must be earlier than or equal to toDate.',
      );
    }

    return {
      /**
       * Prevent payment, data-collection, and unrelated provider logs
       * from appearing in AI analytics.
       */
      serviceCategory: ExternalServiceCategory.AI,

      ...(fromDate !== undefined || toDate !== undefined
        ? {
            createdAt: {
              ...(fromDate !== undefined
                ? {
                    gte: fromDate,
                  }
                : {}),

              ...(toDate !== undefined
                ? {
                    lte: toDate,
                  }
                : {}),
            },
          }
        : {}),

      ...(query.providerKey !== undefined
        ? {
            providerKey: query.providerKey,
          }
        : {}),

      ...(query.requestType !== undefined
        ? {
            requestType: query.requestType,
          }
        : {}),

      ...(query.aiModelId !== undefined
        ? {
            aiModelId: query.aiModelId,
          }
        : {}),
    };
  }

  /**
   * Parses the inclusive beginning of an analytics date range.
   *
   * Date-only values naturally resolve to the beginning of the given
   * UTC calendar day.
   */
  private parseStartDate(value: string): Date {
    return new Date(value);
  }

  /**
   * Parses the inclusive end of an analytics date range.
   *
   * Date-time values are preserved exactly.
   * Date-only values are converted to 23:59:59.999 UTC.
   */
  private parseEndDate(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }

    return new Date(value);
  }

  /**
   * Calculates a percentage rounded to two decimal places.
   */
  private calculatePercentage(value: number, total: number): number {
    if (total === 0) {
      return 0;
    }

    return Number(((value / total) * 100).toFixed(2));
  }

  /**
   * Converts Prisma Decimal or numeric aggregates into rounded
   * JavaScript numbers.
   */
  private toRoundedNumber(
    value: Prisma.Decimal | number | null | undefined,
    decimalPlaces = 2,
  ): number {
    if (value === null || value === undefined) {
      return 0;
    }

    const numericValue =
      value instanceof Prisma.Decimal ? value.toNumber() : value;

    return Number(numericValue.toFixed(decimalPlaces));
  }
}
