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

/**
 * Provides administrative operations for monitoring
 * AI and external API requests.
 *
 * This service allows administrators to retrieve
 * paginated API request logs with support for
 * filtering, searching, and sorting.
 *
 * @author Malak
 */
@Injectable()
export class AiMonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves AI and external API request logs.
   *
   * Supports pagination, filtering by provider,
   * request type, success status, and creation date,
   * as well as keyword search and customizable sorting.
   *
   * @param query Query parameters containing pagination,
   * filtering, searching, and sorting options.
   * @returns Paginated list of API request logs with
   * metadata including page information and total count.
   *
   * @author Malak
   */
  async getAiLogs(query: GetAiLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const isSuccess =
      query.isSuccess !== undefined
        ? query.isSuccess === 'true'
        : undefined;

    const where: Prisma.ExternalApiLogWhereInput = {
      ...buildDateFilter(query),

      ...buildSearchFilter(
        ['endpoint', 'requestId', 'errorMessage'],
        query.search,
      ),

      ...buildExactFilter('provider', query.provider),
      ...buildExactFilter('requestType', query.requestType),
      ...buildExactFilter('isSuccess', isSuccess),
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
}