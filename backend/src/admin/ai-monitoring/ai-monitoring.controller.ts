
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetAiLogsQueryDto } from './dto/get-ai-logs-query.dto';

import {
  buildPagination,
  buildDateFilter,
  buildSearchFilter,
  buildOrderBy,
  buildExactFilter,
} from '../../utilities/base-query/builder';

import {
  calculateSuccessRate,
  toNumber,
} from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for monitoring AI and external API logs.
 *
 * Provides:
 * - Paginated AI/API logs.
 * - Filtering by provider, request type, success status, and date range.
 * - Search by endpoint, request ID, and error message.
 * - Safe sorting using whitelisted fields.
 * - AI monitoring summary reports.
 *
 * This is an admin-only monitoring module used for debugging,
 * analytics, performance tracking, cost monitoring, and system observability.
 *
 * @author Malak
 */
@Injectable()
export class AiMonitoringService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Retrieves AI / External API logs with:
   * - Pagination
   * - Filtering
   * - Search
   * - Sorting
   *
   * @param query - DTO containing filters and pagination options.
   * @returns Paginated AI/API logs with metadata.
   */
  async getAiLogs(query: GetAiLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.ExternalApiLogWhereInput = {
      ...buildDateFilter(query),

      ...buildSearchFilter(
        ['endpoint', 'requestId', 'errorMessage'],
        query.search,
      ),

      ...buildExactFilter('provider', query.provider),
      ...buildExactFilter('requestType', query.requestType),
      ...buildExactFilter('isSuccess', query.isSuccess),
    };

    const orderBy = buildOrderBy(
      query,
      [
        'provider',
        'requestType',
        'isSuccess',
        'statusCode',
        'responseTimeMs',
        'costEstimate',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const [logs, total] = await Promise.all([
      this.prisma.externalApiLog.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          provider: true,
          endpoint: true,
          requestId: true,
          requestType: true,
          statusCode: true,
          isSuccess: true,
          responseTimeMs: true,
          errorMessage: true,
          costEstimate: true,
          createdAt: true,

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          idea: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),

      this.prisma.externalApiLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves a summary report for AI and external API usage.
   *
   * This method is used by:
   * GET /admin/ai/summary
   *
   * Summary includes:
   * - Total API requests.
   * - Successful API requests.
   * - Failed API requests.
   * - Success rate.
   * - Error rate.
   * - Average response time.
   * - Estimated total API cost.
   *
   * @returns AI monitoring summary statistics.
   */
  async getAiSummary() {
    const [
      totalRequests,
      successfulRequests,
      failedRequests,
      responseTimeAggregate,
      costAggregate,
    ] = await Promise.all([
      this.prisma.externalApiLog.count(),

      this.prisma.externalApiLog.count({
        where: { isSuccess: true },
      }),

      this.prisma.externalApiLog.count({
        where: { isSuccess: false },
      }),

      this.prisma.externalApiLog.aggregate({
        _avg: {
          responseTimeMs: true,
        },
      }),

      this.prisma.externalApiLog.aggregate({
        _sum: {
          costEstimate: true,
        },
      }),
    ]);

    const successRate = calculateSuccessRate(
      successfulRequests,
      totalRequests,
    );

    const errorRate = calculateSuccessRate(
      failedRequests,
      totalRequests,
    );

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate,
      errorRate,
      averageResponseTime: toNumber(
        responseTimeAggregate._avg.responseTimeMs,
      ),
      totalCost: toNumber(costAggregate._sum.costEstimate),
    };
  }
}
