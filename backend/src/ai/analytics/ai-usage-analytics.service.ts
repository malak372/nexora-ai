
import { Injectable } from '@nestjs/common';
import {
  AiProviderType,
  ApiProvider,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  AI_PROVIDER_TO_API_PROVIDER,
} from '../constants';

import { GetAiAnalyticsQueryDto } from './dto/get-ai-analytics-query.dto';

import {
  AiUsageAnalyticsSummary,
} from './types/ai-usage-analytics.type';

/**
 * Aggregation selection used for per-model usage analytics.
 *
 * Defining the arguments with Prisma validator preserves precise
 * return types for _count, _sum, and _avg.
 */
const AI_USAGE_BY_MODEL_GROUP_ARGS =
  Prisma.validator<Prisma.ExternalApiLogGroupByArgs>()({
    by: ['aiModelId'],
    orderBy: {
      aiModelId: 'asc',
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
 * Aggregation selection used to count successful requests
 * for every AI model.
 */
const AI_SUCCESS_BY_MODEL_GROUP_ARGS =
  Prisma.validator<Prisma.ExternalApiLogGroupByArgs>()({
    by: ['aiModelId'],
    orderBy: {
      aiModelId: 'asc',
    },
    _count: {
      _all: true,
    },
  });

/**
 * Provides aggregated AI request, usage, cost,
 * latency, and fallback analytics.
 *
 * Analytics are calculated from ExternalApiLog records.
 *
 * @author Malak
 */
@Injectable()
export class AiUsageAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Returns an aggregated AI usage summary.
   *
   * @param query Optional date, provider, request-type,
   * and model filters.
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
       * Total external AI-provider calls.
       */
      this.prisma.externalApiLog.count({
        where,
      }),

      /**
       * Successful external AI-provider calls.
       */
      this.prisma.externalApiLog.count({
        where: {
          ...where,
          isSuccess: true,
        },
      }),

      /**
       * Calls that used a fallback model.
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
       * Usage aggregates grouped by AI model.
       *
       * orderBy is included explicitly because the generated Prisma
       * client requires it for this groupBy argument shape.
       */
      this.prisma.externalApiLog.groupBy({
        ...AI_USAGE_BY_MODEL_GROUP_ARGS,
        where,
      }),

      /**
       * Successful request counts grouped by AI model.
       */
      this.prisma.externalApiLog.groupBy({
        ...AI_SUCCESS_BY_MODEL_GROUP_ARGS,
        where: {
          ...where,
          isSuccess: true,
        },
      }),
    ]);

    const modelIds = byModel
      .map((item) => item.aiModelId)
      .filter(
        (id): id is string =>
          id !== null,
      );

    const models =
      modelIds.length > 0
        ? await this.prisma.aiModel.findMany({
            where: {
              id: {
                in: modelIds,
              },
            },
            select: {
              id: true,
              provider: true,
              modelName: true,
              apiModelId: true,
            },
          })
        : [];

    const modelMap = new Map(
      models.map((model) => [
        model.id,
        model,
      ]),
    );

    const successCountMap = new Map<
      string | null,
      number
    >(
      successfulByModel.map((item) => [
        item.aiModelId,
        item._count._all,
      ]),
    );

    return {
      totalRequests,

      successfulRequests,

      failedRequests:
        totalRequests -
        successfulRequests,

      successRate:
        this.calculatePercentage(
          successfulRequests,
          totalRequests,
        ),

      averageResponseTimeMs:
        this.toRoundedNumber(
          aggregates._avg
            .responseTimeMs,
        ),

      totalInputTokens:
        aggregates._sum
          .inputTokens ?? 0,

      totalOutputTokens:
        aggregates._sum
          .outputTokens ?? 0,

      totalCost:
        this.toRoundedNumber(
          aggregates._sum
            .costEstimate,
          6,
        ),

      fallbackAttempts,

      models: byModel.map((item) => {
        const requests =
          item._count._all;

        const successfulModelRequests =
          successCountMap.get(
            item.aiModelId,
          ) ?? 0;

        return {
          aiModelId:
            item.aiModelId,

          model:
            item.aiModelId
              ? modelMap.get(
                  item.aiModelId,
                ) ?? null
              : null,

          requests,

          successfulRequests:
            successfulModelRequests,

          failedRequests:
            requests -
            successfulModelRequests,

          inputTokens:
            item._sum
              .inputTokens ?? 0,

          outputTokens:
            item._sum
              .outputTokens ?? 0,

          cost:
            this.toRoundedNumber(
              item._sum
                .costEstimate,
              6,
            ),

          averageResponseTimeMs:
            this.toRoundedNumber(
              item._avg
                .responseTimeMs,
            ),
        };
      }),
    };
  }

  /**
   * Builds ExternalApiLog query filters.
   */
  private buildWhere(
    query: GetAiAnalyticsQueryDto,
  ): Prisma.ExternalApiLogWhereInput {
    const fromDate =
      query.fromDate
        ? new Date(query.fromDate)
        : undefined;

    const toDate =
      query.toDate
        ? new Date(query.toDate)
        : undefined;

    return {
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate
                ? {
                    gte: fromDate,
                  }
                : {}),
              ...(toDate
                ? {
                    lte: toDate,
                  }
                : {}),
            },
          }
        : {}),

      ...(query.provider !== undefined
        ? {
            provider:
              this.mapProvider(
                query.provider,
              ),
          }
        : {}),

      ...(query.requestType !== undefined
        ? {
            requestType:
              query.requestType,
          }
        : {}),

      ...(query.aiModelId !== undefined
        ? {
            aiModelId:
              query.aiModelId,
          }
        : {}),
    };
  }

  /**
   * Maps AiProviderType into the provider enum stored
   * by ExternalApiLog.
   */
  private mapProvider(
    provider: AiProviderType,
  ): ApiProvider {
    return AI_PROVIDER_TO_API_PROVIDER[
      provider
    ];
  }

  /**
   * Calculates a percentage rounded to two decimal places.
   */
  private calculatePercentage(
    value: number,
    total: number,
  ): number {
    if (total === 0) {
      return 0;
    }

    return Number(
      (
        (value / total) *
        100
      ).toFixed(2),
    );
  }

  /**
   * Converts Decimal or numeric aggregate values into rounded
   * JavaScript numbers.
   */
  private toRoundedNumber(
    value:
      | Prisma.Decimal
      | number
      | null
      | undefined,
    decimalPlaces = 2,
  ): number {
    if (
      value === null ||
      value === undefined
    ) {
      return 0;
    }

    const numericValue =
      value instanceof Prisma.Decimal
        ? value.toNumber()
        : value;

    return Number(
      numericValue.toFixed(
        decimalPlaces,
      ),
    );
  }
}

