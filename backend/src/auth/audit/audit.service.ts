import { Injectable } from '@nestjs/common';

import {
  AuthenticationLog,
  AuthAction,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import { GetAuthAuditQueryDto } from '../dto/get-auth-audit-query.dto';

/**
 * Request metadata stored with an authentication event.
 */
export type AuthRequestMeta = {
  readonly ipAddress?: string;
  readonly userAgent?: string;
};

/**
 * Input used by the authentication flows to append one security event.
 */
export type CreateAuthLogInput = AuthRequestMeta & {
  readonly userId?: string;
  readonly email?: string;
  readonly action: AuthAction;
  readonly isSuccess?: boolean;
  readonly message?: string;
};

/**
 * Authentication security audit service.
 *
 * The write path remains intentionally append-only. Administrator reads add
 * pagination, filtering, sorting and summary counters without mutating logs.
 *
 * @author Eman
 */
@Injectable()
export class AuthAuditService {
  constructor(private readonly prisma: PrismaService) { }

  async createLog(input: CreateAuthLogInput): Promise<AuthenticationLog> {
    return this.prisma.authenticationLog.create({
      data: {
        userId: input.userId,
        email: input.email,
        action: input.action,
        isSuccess: input.isSuccess ?? true,
        message: input.message,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  /**
   * Paginated authentication event ledger for administrators.
   */
  async getLogs(query: GetAuthAuditQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.authenticationLog.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(
          query,
          ['createdAt', 'action', 'email', 'isSuccess'] as const,
          'createdAt',
        ),
        select: {
          id: true,
          userId: true,
          email: true,
          action: true,
          isSuccess: true,
          message: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
              isActive: true,
              isVerified: true,
            },
          },
        },
      }),
      this.prisma.authenticationLog.count({ where }),
    ]);

    return {
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Summary counters use the same action/search/date filters while deliberately
   * ignoring result-status filtering so the UI can show success and failure
   * counters at the same time.
   */
  async getSummary(query: GetAuthAuditQueryDto) {
    const where = this.buildWhere(query, false);

    const [
      totalEvents,
      successfulEvents,
      failedEvents,
      accountLockEvents,
      distinctIps,
      distinctUsers,
      groupedNetworkSources,
    ] = await Promise.all([
      this.prisma.authenticationLog.count({ where }),
      this.prisma.authenticationLog.count({
        where: {
          AND: [where, { isSuccess: true }],
        },
      }),
      this.prisma.authenticationLog.count({
        where: {
          AND: [where, { isSuccess: false }],
        },
      }),
      this.prisma.authenticationLog.count({
        where: {
          AND: [
            where,
            {
              action: AuthAction.ACCOUNT_LOCKED,
            },
          ],
        },
      }),
      this.prisma.authenticationLog.findMany({
        where: {
          AND: [
            where,
            {
              ipAddress: {
                not: null,
              },
            },
          ],
        },
        distinct: ['ipAddress'],
        select: {
          ipAddress: true,
        },
      }),
      this.prisma.authenticationLog.findMany({
        where: {
          AND: [
            where,
            {
              userId: {
                not: null,
              },
            },
          ],
        },
        distinct: ['userId'],
        select: {
          userId: true,
        },
      }),
      this.prisma.authenticationLog.groupBy({
        by: ['ipAddress', 'isSuccess', 'action'],
        where: {
          AND: [
            where,
            {
              ipAddress: {
                not: null,
              },
            },
          ],
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const networkSourceMap = new Map<
      string,
      {
        ipAddress: string;
        totalEvents: number;
        successfulEvents: number;
        failedEvents: number;
        lockEvents: number;
      }
    >();

    for (const group of groupedNetworkSources) {
      if (!group.ipAddress) continue;

      const current = networkSourceMap.get(group.ipAddress) ?? {
        ipAddress: group.ipAddress,
        totalEvents: 0,
        successfulEvents: 0,
        failedEvents: 0,
        lockEvents: 0,
      };
      const count = group._count._all;

      current.totalEvents += count;
      if (group.isSuccess) current.successfulEvents += count;
      else current.failedEvents += count;
      if (group.action === AuthAction.ACCOUNT_LOCKED) current.lockEvents += count;

      networkSourceMap.set(group.ipAddress, current);
    }

    const riskSources = Array.from(networkSourceMap.values())
      .map((source) => {
        const failureRatio = source.totalEvents > 0
          ? source.failedEvents / source.totalEvents
          : 0;
        const riskScore = Math.min(
          100,
          Math.round((failureRatio * 72) + (Math.min(source.lockEvents, 3) * 10)),
        );

        return {
          ...source,
          riskScore,
          riskLevel: source.lockEvents > 0 || riskScore >= 65
            ? 'critical'
            : riskScore >= 35
              ? 'high'
              : source.failedEvents > 0
                ? 'medium'
                : 'low',
        };
      })
      .sort((left, right) =>
        right.riskScore - left.riskScore
        || right.failedEvents - left.failedEvents
        || right.totalEvents - left.totalEvents,
      )
      .slice(0, 18);

    return {
      totalEvents,
      successfulEvents,
      failedEvents,
      accountLockEvents,
      uniqueIpAddresses: distinctIps.length,
      uniqueUsers: distinctUsers.length,
      riskSources,
    };
  }

  private buildWhere(
    query: GetAuthAuditQueryDto,
    includeSuccessFilter = true,
  ): Prisma.AuthenticationLogWhereInput {
    const search = query.search?.trim();

    return {
      ...(buildDateFilter(query) ?? {}),
      ...(query.action
        ? {
          action: query.action,
        }
        : {}),
      ...(includeSuccessFilter && query.isSuccess !== undefined
        ? {
          isSuccess: query.isSuccess,
        }
        : {}),
      ...(search
        ? {
          OR: [
            {
              email: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              message: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              ipAddress: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              userAgent: {
                contains: search,
                mode: 'insensitive',
              },
            },
            {
              user: {
                fullName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
            {
              user: {
                email: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            },
          ],
        }
        : {}),
    };
  }
}