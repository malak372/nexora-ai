import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  buildCsv,
  calculateSuccessRate,
  calculateTotalPages,
  toNumber,
} from '../../utilities/analytics/analytics.helper';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { PrismaService } from '../../prisma/prisma.service';
import { GetAiLogsQueryDto } from './dto/get-ai-logs-query.dto';

/**
 * Shared relation projection used by AI-monitoring log endpoints.
 */
const AI_LOG_RELATION_SELECT = {
  aiModel: {
    select: {
      id: true,
      providerKey: true,
      apiModelId: true,
      modelName: true,
      displayName: true,
      healthStatus: true,
      consecutiveFailures: true,
    },
  },
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
} as const satisfies Prisma.ExternalApiLogSelect;

/**
 * Shared scalar and relation projection for administrator diagnostics.
 */
const AI_LOG_SELECT = {
  id: true,
  serviceCategory: true,
  providerKey: true,
  aiModelId: true,
  apiModelId: true,
  endpoint: true,
  requestId: true,
  requestType: true,
  operationId: true,
  attemptNumber: true,
  fallbackUsed: true,
  statusCode: true,
  isSuccess: true,
  responseTimeMs: true,
  inputTokens: true,
  outputTokens: true,
  errorCode: true,
  errorMessage: true,
  isRetryable: true,
  costEstimate: true,
  createdAt: true,
  ...AI_LOG_RELATION_SELECT,
} as const satisfies Prisma.ExternalApiLogSelect;

/**
 * Service responsible for administrator AI-provider monitoring.
 *
 * The service exposes both individual request attempts and complete operation
 * timelines. One logical AI operation may contain retries, structured-output
 * repair, model fallback, and provider fallback, so inspecting only the final
 * request is insufficient for troubleshooting.
 *
 * Administrators can determine:
 * - Which provider and exact provider model were called.
 * - Which configured database model was selected.
 * - Whether the attempt was original, retry, or fallback.
 * - The normalized error category and safe provider message.
 * - The HTTP status, provider request ID, and retry eligibility.
 * - Whether a later model/provider successfully completed the operation.
 *
 * @author Malak
 */
@Injectable()
export class AiMonitoringService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds a shared Prisma filter for all AI-monitoring endpoints.
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
              operationId: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              apiModelId: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
            {
              errorCode: {
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
              aiModel: {
                modelName: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
            {
              aiModel: {
                displayName: {
                  contains: query.search,
                  mode: 'insensitive',
                },
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
      ...buildExactFilter('aiModelId', query.aiModelId),
      ...buildExactFilter('apiModelId', query.apiModelId),
      ...buildExactFilter('operationId', query.operationId),
      ...buildExactFilter('requestType', query.requestType),
      ...buildExactFilter('errorCode', query.errorCode),
      ...buildExactFilter('isSuccess', query.isSuccess),
      ...buildExactFilter('isRetryable', query.isRetryable),
      ...buildExactFilter('fallbackUsed', query.fallbackUsed),
    };
  }

  /**
   * Retrieves paginated external AI request attempts.
   *
   * Endpoint: GET /admin/ai-monitoring/logs
   */
  async getAiLogs(query: GetAiLogsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildAiLogsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'providerKey',
        'apiModelId',
        'requestType',
        'operationId',
        'attemptNumber',
        'fallbackUsed',
        'isSuccess',
        'errorCode',
        'isRetryable',
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
        select: AI_LOG_SELECT,
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
   * Retrieves one detailed external AI request attempt.
   *
   * Endpoint: GET /admin/ai-monitoring/logs/:id
   */
  async getAiLogById(id: string) {
    const log = await this.prisma.externalApiLog.findUnique({
      where: { id },
      select: AI_LOG_SELECT,
    });

    if (!log) {
      throw new NotFoundException(`AI monitoring log "${id}" was not found.`);
    }

    return log;
  }

  /**
   * Retrieves every request attempt belonging to one logical AI operation.
   *
   * The timeline shows retries and fallbacks in execution order, which allows
   * administrators to see the failed provider and the provider/model that
   * eventually succeeded.
   *
   * Endpoint: GET /admin/ai-monitoring/operations/:operationId
   */
  async getAiOperationTimeline(operationId: string) {
    const attempts = await this.prisma.externalApiLog.findMany({
      where: { operationId },
      orderBy: [{ attemptNumber: 'asc' }, { createdAt: 'asc' }],
      select: AI_LOG_SELECT,
    });

    if (attempts.length === 0) {
      throw new NotFoundException(
        `AI operation "${operationId}" was not found.`,
      );
    }

    const successfulAttempt = attempts.find((attempt) => attempt.isSuccess);
    const finalAttempt = attempts[attempts.length - 1];

    return {
      operationId,
      succeeded: Boolean(successfulAttempt),
      totalAttempts: attempts.length,
      failedAttempts: attempts.filter((attempt) => !attempt.isSuccess).length,
      fallbackAttempts: attempts.filter((attempt) => attempt.fallbackUsed)
        .length,
      successfulAttempt: successfulAttempt ?? null,
      finalAttempt,
      attempts,
    };
  }

  /**
   * Exports filtered external AI logs as CSV.
   *
   * Endpoint: GET /admin/ai-monitoring/logs/export/csv
   */
  async exportAiLogsCsv(query: GetAiLogsQueryDto) {
    const where = this.buildAiLogsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'providerKey',
        'apiModelId',
        'requestType',
        'operationId',
        'attemptNumber',
        'fallbackUsed',
        'isSuccess',
        'errorCode',
        'isRetryable',
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
      select: AI_LOG_SELECT,
    });

    const headers = [
      'Log ID',
      'Operation ID',
      'Attempt Number',
      'Fallback Used',
      'Provider',
      'AI Model ID',
      'Configured Model Name',
      'Configured Display Name',
      'Provider API Model ID',
      'Endpoint',
      'Provider Request ID',
      'Request Type',
      'Status Code',
      'Is Success',
      'Error Code',
      'Is Retryable',
      'Error Message',
      'Response Time Ms',
      'Input Tokens',
      'Output Tokens',
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
      log.operationId ?? '',
      log.attemptNumber,
      log.fallbackUsed,
      log.providerKey,
      log.aiModelId ?? '',
      log.aiModel?.modelName ?? '',
      log.aiModel?.displayName ?? '',
      log.apiModelId ?? '',
      log.endpoint ?? '',
      log.requestId ?? '',
      log.requestType,
      log.statusCode ?? '',
      log.isSuccess,
      log.errorCode ?? '',
      log.isRetryable ?? '',
      log.errorMessage ?? '',
      log.responseTimeMs ?? '',
      log.inputTokens ?? '',
      log.outputTokens ?? '',
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
   * Retrieves an AI-provider usage and failure summary.
   *
   * Endpoint: GET /admin/ai-monitoring/summary
   */
  async getAiSummary(query: GetAiLogsQueryDto) {
    const where = this.buildAiLogsWhere(query);

    const canIncludeSuccess = query.isSuccess !== false;
    const canIncludeFailure = query.isSuccess !== true;

    const [
      totalRequests,
      successfulRequests,
      failedRequests,
      retryableFailures,
      fallbackAttempts,
      responseTimeAggregate,
      costAggregate,
      failuresByProvider,
      failuresByErrorCode,
    ] = await Promise.all([
      this.prisma.externalApiLog.count({ where }),
      canIncludeSuccess
        ? this.prisma.externalApiLog.count({
            where: { ...where, isSuccess: true },
          })
        : Promise.resolve(0),
      canIncludeFailure
        ? this.prisma.externalApiLog.count({
            where: { ...where, isSuccess: false },
          })
        : Promise.resolve(0),
      canIncludeFailure
        ? this.prisma.externalApiLog.count({
            where: {
              ...where,
              isSuccess: false,
              isRetryable: true,
            },
          })
        : Promise.resolve(0),
      this.prisma.externalApiLog.count({
        where: { ...where, fallbackUsed: true },
      }),
      this.prisma.externalApiLog.aggregate({
        where,
        _avg: { responseTimeMs: true },
      }),
      this.prisma.externalApiLog.aggregate({
        where,
        _sum: { costEstimate: true },
      }),
      canIncludeFailure
        ? this.prisma.externalApiLog.groupBy({
            by: ['providerKey'],
            where: { ...where, isSuccess: false },
            _count: { providerKey: true },
            orderBy: { _count: { providerKey: 'desc' } },
          })
        : Promise.resolve([]),
      canIncludeFailure
        ? this.prisma.externalApiLog.groupBy({
            by: ['errorCode'],
            where: {
              ...where,
              isSuccess: false,
              errorCode: { not: null },
            },
            _count: { errorCode: true },
            orderBy: { _count: { errorCode: 'desc' } },
          })
        : Promise.resolve([]),
    ]);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      retryableFailures,
      nonRetryableFailures: Math.max(failedRequests - retryableFailures, 0),
      fallbackAttempts,
      successRate: calculateSuccessRate(successfulRequests, totalRequests),
      errorRate: calculateSuccessRate(failedRequests, totalRequests),
      averageResponseTime: toNumber(responseTimeAggregate._avg.responseTimeMs),
      totalCost: toNumber(costAggregate._sum.costEstimate),
      failuresByProvider: failuresByProvider.map((item) => ({
        providerKey: item.providerKey,
        count: item._count.providerKey,
      })),
      failuresByErrorCode: failuresByErrorCode.map((item) => ({
        errorCode: item.errorCode,
        count: item._count.errorCode,
      })),
    };
  }

  /**
   * Retrieves chart-ready AI-provider analytics.
   *
   * Endpoint: GET /admin/ai-monitoring/charts
   */
  async getAiCharts(query: GetAiLogsQueryDto) {
    const where = this.buildAiLogsWhere(query);
    const canIncludeSuccess = query.isSuccess !== false;
    const canIncludeFailure = query.isSuccess !== true;

    const [
      requestsByProvider,
      requestsByType,
      successCount,
      failedCount,
      failuresByProvider,
      failuresByErrorCode,
    ] = await Promise.all([
      this.prisma.externalApiLog.groupBy({
        by: ['providerKey'],
        where,
        _count: { providerKey: true },
        orderBy: { _count: { providerKey: 'desc' } },
      }),
      this.prisma.externalApiLog.groupBy({
        by: ['requestType'],
        where,
        _count: { requestType: true },
        orderBy: { _count: { requestType: 'desc' } },
      }),
      canIncludeSuccess
        ? this.prisma.externalApiLog.count({
            where: { ...where, isSuccess: true },
          })
        : Promise.resolve(0),
      canIncludeFailure
        ? this.prisma.externalApiLog.count({
            where: { ...where, isSuccess: false },
          })
        : Promise.resolve(0),
      canIncludeFailure
        ? this.prisma.externalApiLog.groupBy({
            by: ['providerKey'],
            where: { ...where, isSuccess: false },
            _count: { providerKey: true },
            orderBy: { _count: { providerKey: 'desc' } },
          })
        : Promise.resolve([]),
      canIncludeFailure
        ? this.prisma.externalApiLog.groupBy({
            by: ['errorCode'],
            where: {
              ...where,
              isSuccess: false,
              errorCode: { not: null },
            },
            _count: { errorCode: true },
            orderBy: { _count: { errorCode: 'desc' } },
          })
        : Promise.resolve([]),
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
      failuresByProvider: failuresByProvider.map((item) => ({
        label: item.providerKey,
        count: item._count.providerKey,
      })),
      failuresByErrorCode: failuresByErrorCode.map((item) => ({
        label: item.errorCode,
        count: item._count.errorCode,
      })),
      successFailureChart: [
        { label: 'SUCCESSFUL', count: successCount },
        { label: 'FAILED', count: failedCount },
      ],
    };
  }
}