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
 * Service responsible for monitoring AI and external API logs.
 *
 * Provides:
 * - Pagination
 * - Filtering (provider, request type, success status)
 * - Search (endpoint, requestId, errorMessage)
 * - Sorting (whitelisted fields only)
 *
 * This is an admin-only monitoring module used for
 * debugging, analytics, and system observability.
 *
 * @author Malak
 */
@Injectable()
export class AiMonitoringService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Retrieves AI / External API logs with:
   * - pagination
   * - filtering
   * - search
   * - sorting
   *
   * Query transformation is handled through reusable
   * global query builder utilities.
   *
   * @param query - DTO containing filters & pagination options
   * @returns paginated logs with metadata
   */
  async getAiLogs(query: GetAiLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    /**
     * Build Prisma WHERE filter using reusable builders
     */
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

    /**
     * Build safe ORDER BY using whitelist
     */
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

    /**
     * Execute queries in parallel for performance
     */
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

    /**
     * Final response with pagination metadata
     */
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