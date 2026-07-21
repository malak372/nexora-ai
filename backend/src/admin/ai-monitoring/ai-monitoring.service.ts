import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetAiLogsQueryDto } from './dto/get-ai-logs-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import {
  buildCsv,
  calculateSuccessRate,
  calculateTotalPages,
  toNumber,
} from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for monitoring AI and external API logs.
 *
 * Provides admin-only functionality for:
 * - Viewing paginated API logs.
 * - Filtering logs by provider, request type, success status, and date range.
 * - Searching logs by endpoint, request ID, and error message.
 * - Sorting logs safely using whitelisted fields.
 * - Generating summary reports.
 * - Generating chart-ready analytics.
 *
 * @author Malak
 */
@Injectable()
export class AiMonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds a shared Prisma where filter for AI monitoring endpoints.
   *
   * This keeps logs, summary, and charts consistent when filters are applied.
   *
   * @param query - AI monitoring filters.
   * @returns Prisma ExternalApiLog where input.
   */
  private buildAiLogsWhere(
    query: GetAiLogsQueryDto,
  ): Prisma.ExternalApiLogWhereInput {
    const searchFilter: Prisma.ExternalApiLogWhereInput = query.search
      ? {
          OR: [
            {
              endpoint: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              requestId: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              errorMessage: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              user: {
                fullName: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
            {
              user: {
                email: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
            {
              idea: {
                title: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
          ],
        }
      : {};

    return {
      ...buildDateFilter(query),
      ...searchFilter,
      ...buildExactFilter('providerKey', query.providerKey),
      ...buildExactFilter('requestType', query.requestType),
      ...buildExactFilter('isSuccess', query.isSuccess),
    };
  }

  /**
   * Retrieves paginated external API logs.
   *
   * Supports:
   * - Pagination.
   * - Filtering.
   * - Searching.
   * - Safe sorting.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/logs
   *
   * @param query - Query filters and pagination options.
   * @returns Paginated API logs with metadata.
   */
  async getAiLogs(query: GetAiLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildAiLogsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'providerKey',
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
          providerKey: true,
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
   * Exports filtered external API logs as CSV.
   *
   * Uses the same filters and sorting rules
   * as the logs list endpoint.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/logs/export/csv
   */
  async exportAiLogsCsv(query: GetAiLogsQueryDto) {
    const where = this.buildAiLogsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'providerKey',
        'requestType',
        'isSuccess',
        'statusCode',
        'responseTimeMs',
        'costEstimate',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const logs = await this.prisma.externalApiLog.findMany({
      where,
      orderBy,
      select: {
        id: true,
        providerKey: true,
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
    });

    const headers = [
      'Log ID',
      'Provider',
      'Endpoint',
      'Request ID',
      'Request Type',
      'Status Code',
      'Is Success',
      'Response Time Ms',
      'Error Message',
      'Cost Estimate',
      'User ID',
      'User Name',
      'User Email',
      'Idea ID',
      'Idea Title',
      'Created At',
    ];

    const rows = logs.map((log) => [
      log.id,
      log.providerKey,
      log.endpoint,
      log.requestId ?? '',
      log.requestType,
      log.statusCode ?? '',
      log.isSuccess,
      log.responseTimeMs ?? '',
      log.errorMessage ?? '',
      toNumber(log.costEstimate),
      log.user?.id ?? '',
      log.user?.fullName ?? '',
      log.user?.email ?? '',
      log.idea?.id ?? '',
      log.idea?.title ?? '',
      log.createdAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Retrieves a summary report for external API usage.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/summary
   *
   * @param query - Optional filters used to scope the summary.
   * @returns Summary statistics.
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
      successRate: calculateSuccessRate(successfulRequests, totalRequests),
      errorRate: calculateSuccessRate(failedRequests, totalRequests),
      averageResponseTime: toNumber(responseTimeAggregate._avg.responseTimeMs),
      totalCost: toNumber(costAggregate._sum.costEstimate),
    };
  }

  /**
   * Retrieves chart-ready external API monitoring analytics.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/charts
   *
   * @param query - Optional filters used to scope the charts.
   * @returns Chart-ready analytics data.
   */
  async getAiCharts(query: GetAiLogsQueryDto) {
    const where = this.buildAiLogsWhere(query);

    const [requestsByProvider, requestsByType, successCount, failedCount] =
      await Promise.all([
        this.prisma.externalApiLog.groupBy({
          by: ['providerKey'],
          where,
          _count: {
            providerKey: true,
          },
          orderBy: {
            _count: {
              providerKey: 'desc',
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
        label: item.providerKey,
        count: item._count.providerKey,
      })),

      requestsByType: requestsByType.map((item) => ({
        label: item.requestType,
        count: item._count.requestType,
      })),

      successFailureChart: [
        {
          label: 'SUCCESSFUL',
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
