import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AlertType,
  UserRole,
  Prisma,
  AdminAction,
  AdminTargetType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { GetAlertsQueryDto } from './dto/get-alerts-query.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for Admin alert management operations.
 *
 * This service allows administrators to:
 * - View alerts.
 * - Search and filter alerts.
 * - Send notifications to a specific user.
 * - Broadcast notifications to all active users.
 *
 * Alerts are stored in the database and can later be
 * displayed to users inside the application.
 *
 * @author Malak
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }

  /**
   * Retrieves alerts with optional filtering, searching,
   * sorting, and pagination.
   *
   * @param query Query parameters used for pagination,
   * filtering, searching, and sorting alerts.
   * @returns Paginated alerts list with metadata.
   */
  async getAlerts(query: GetAlertsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const searchFilter = query.search?.trim()
      ? {
        OR: [
          {
            title: {
              contains: query.search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            message: {
              contains: query.search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            user: {
              fullName: {
                contains: query.search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          },
          {
            user: {
              email: {
                contains: query.search,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          },
        ],
      }
      : {};

    const where: Prisma.AlertWhereInput = {
      ...buildDateFilter(query),
      ...buildExactFilter('type', query.type),
      ...buildExactFilter('isRead', query.isRead),
      ...searchFilter,
    };



    const orderBy = buildOrderBy(
      query,
      ['title', 'type', 'isRead', 'createdAt'] as const,
      'createdAt',
    );

    const [alerts, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          title: true,
          message: true,
          type: true,
          isRead: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.alert.count({ where }),
    ]);

    return {
      data: alerts,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Creates and sends a new alert.
   *
   * If userId is provided, the alert is sent to that specific user.
   * If userId is not provided, the alert is broadcast to all active users.
   *
   * @param body DTO containing the alert information.
   * @param adminId ID of the admin who created the alert.
   * @returns A success message and the created alert,
   * or the broadcast count.
   *
   * @throws NotFoundException if the specified user does not exist.
   */
  async createAlert(body: CreateAlertDto, adminId: string) {
    const alertType = body.type ?? AlertType.SYSTEM;

    if (body.userId) {
      const user = await this.prisma.user.findUnique({
        where: {
          id: body.userId,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const alert = await this.prisma.alert.create({
        data: {
          userId: body.userId,
          title: body.title,
          message: body.message,
          type: alertType,
        },
      });

      await this.auditLogsService.createLog({
        adminId,
        action: AdminAction.ADMIN_CREATE_ALERT,
        targetType: AdminTargetType.ALERT,
        targetId: alert.id,
        newValue: {
          id: alert.id,
          userId: alert.userId,
          title: alert.title,
          message: alert.message,
          type: alert.type,
          isRead: alert.isRead,
          createdAt: alert.createdAt.toISOString(),
        },
      });

      return {
        message: 'Alert sent successfully',
        alert,
      };
    }

    const users = await this.prisma.user.findMany({
      where: {
        role: UserRole.USER,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    const alertsData = users.map((user) => ({
      userId: user.id,
      title: body.title,
      message: body.message,
      type: alertType,
    }));

    await this.prisma.alert.createMany({
      data: alertsData,
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_CREATE_ALERT,
      targetType: AdminTargetType.ALERT,
      targetId: 'BROADCAST',
      newValue: {
        broadcast: true,
        sentCount: alertsData.length,
        title: body.title,
        message: body.message,
        type: alertType,
      },
    });

    return {
      message: 'Alert sent to all active users successfully',
      sentCount: alertsData.length,
    };
  }
}