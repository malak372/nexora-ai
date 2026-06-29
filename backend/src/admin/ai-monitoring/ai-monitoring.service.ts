import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetAiLogsQueryDto } from './dto/get-ai-logs-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import {
  calculateSuccessRate,
  calculateTotalPages,
  toNumber,
} from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for monitoring AI and external API logs.
 *
 * Provides admin-only functionality for:
 * - Viewing paginated AI/API logs.
 * - Filtering logs by provider, request type, success status, and date range.
 * - Searching logs by endpoint, request ID, and error message.
 * - Sorting logs safely using whitelisted fields.
 * - Generating summary reports.
 * - Generating chart-ready analytics.
 *
 * This service supports the Admin requirement for monitoring:
 * - Total AI requests.
 * - Request success and failure.
 * - API response times.
 * - Estimated AI costs.
 * - AI logs filtered by provider and request type.
 *
 * @author Malak
 */
@Injectable()
export class AiMonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the shared Prisma where filter for AI monitoring.
   *
   * This keeps logs, summary, and charts consistent
   * when filters are applied.
   *
   * @param query - AI logs query filters.
   * @returns Prisma ExternalApiLog where input.
   */
  private buildAiLogsWhere(
    query: GetAiLogsQueryDto,
  ): Prisma.ExternalApiLogWhereInput {
    return {
      ...buildDateFilter(query),

      ...buildSearchFilter(
        ['endpoint', 'requestId', 'errorMessage'],
        query.search,
      ),

      ...buildExactFilter('provider', query.provider),
      ...buildExactFilter('requestType', query.requestType),
      ...buildExactFilter('isSuccess', query.isSuccess),
    };
  }

  /**
   * Retrieves AI / External API logs with:
   * - Pagination.
   * - Filtering.
   * - Search.
   * - Sorting.
   *
   * Endpoint:
   * GET /admin/ai/logs
   *
   * @param query - DTO containing filters and pagination options.
   * @returns Paginated AI/API logs with metadata.
   */
  async getAiLogs(query: GetAiLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildAiLogsWhere(query);

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
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves a summary report for AI and external API usage.
   *
   * Endpoint:
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
   * @param query - Optional filters used to scope the summary.
   * @returns AI monitoring summary statistics.
   */
  async getAiSummary(query: GetAiLogsQueryDto) {
    const where = this.buildAiLogsWhere(query);

    const [
      totalRequests,
      successfulRequests,
      failedRequests,
      responseTimeAggregate,
      costAggregate,
    ] = await Promise.all([
      this.prisma.externalApiLog.count({ where }),

      this.prisma.externalApiLog.count({
        where: {
          ...where,
          isSuccess: true,
        },
      }),

      this.prisma.externalApiLog.count({
        where: {
          ...where,
          isSuccess: false,
        },
      }),

      this.prisma.externalApiLog.aggregate({
        where,
        _avg: {
          responseTimeMs: true,
        },
      }),

      this.prisma.externalApiLog.aggregate({
        where,
        _sum: {
          costEstimate: true,
        },
      }),
    ]);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate: calculateSuccessRate(
        successfulRequests,
        totalRequests,
      ),
      errorRate: calculateSuccessRate(
        failedRequests,
        totalRequests,
      ),
      averageResponseTime: toNumber(
        responseTimeAggregate._avg.responseTimeMs,
      ),
      totalCost: toNumber(costAggregate._sum.costEstimate),
    };
  }

  /**
   * Retrieves chart-ready AI monitoring analytics.
   *
   * Endpoint:
   * GET /admin/ai/charts
   *
   * Charts include:
   * - Requests by provider.
   * - Requests by request type.
   * - Success vs failed requests.
   *
   * @param query - Optional filters used to scope the charts.
   * @returns Chart-ready AI monitoring data.
   */
  async getAiCharts(query: GetAiLogsQueryDto) {
    const where = this.buildAiLogsWhere(query);

    const [
      requestsByProvider,
      requestsByType,
      successCount,
      failedCount,
    ] = await Promise.all([
      this.prisma.externalApiLog.groupBy({
        by: ['provider'],
        where,
        _count: {
          provider: true,
        },
        orderBy: {
          _count: {
            provider: 'desc',
          },
        },
      }),

      this.prisma.externalApiLog.groupBy({
        by: ['requestType'],
        where,
        _count: {
          requestType: true,
        },
        orderBy: {
          _count: {
            requestType: 'desc',
          },
        },
      }),

      this.prisma.externalApiLog.count({
        where: {
          ...where,
          isSuccess: true,
        },
      }),

      this.prisma.externalApiLog.count({
        where: {
          ...where,
          isSuccess: false,
        },
      }),
    ]);

    return {
      requestsByProvider: requestsByProvider.map((item) => ({
        label: item.provider,
        count: item._count.provider,
      })),

      requestsByType: requestsByType.map((item) => ({
        label: item.requestType,
        count: item._count.requestType,
      })),

      successFailureChart: [
        {
          label: 'SUCCESS',
          count: successCount,
        },
        {
          label: 'FAILED',
          count: failedCount,
        },
      ],
    };
  }
}