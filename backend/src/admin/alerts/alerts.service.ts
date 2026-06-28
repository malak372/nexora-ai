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
  /**
   * Creates an instance of AlertsService.
   *
   * @param prisma - Prisma service used to access the database.
   * @param auditLogsService - Service used to record admin audit logs.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }
  /**
  * Builds the Prisma sorting configuration for alert queries.
  *
  * Maps the requested sorting field and direction
  * from the query parameters into a Prisma-compatible
  * orderBy object.
  *
  * If no sorting field is provided, alerts are
  * sorted by creation date in descending order.
  *
  * @param query Query parameters containing the optional
  * sorting field and sorting direction.
  * @returns Prisma orderBy object used when retrieving alerts.
  *
  * @author Malak
  */
  private buildAlertsOrderBy(query: GetAlertsQueryDto) {
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';

    switch (query.sortBy) {
      case 'title':
        return { title: sortOrder };

      case 'type':
        return { type: sortOrder };

      case 'isRead':
        return { isRead: sortOrder };

      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  /**
   * Retrieves alerts with optional filtering, searching, and pagination.
   *
   * @param query - Query parameters used for pagination, searching, and filtering alerts.
   * @returns Paginated alerts list with metadata.
   */
  async getAlerts(query: GetAlertsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.AlertWhereInput = {};

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate && {
          gte: new Date(query.fromDate),
        }),
        ...(query.toDate && {
          lte: new Date(query.toDate),
        }),
      };
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.isRead === 'true') {
      where.isRead = true;
    }

    if (query.isRead === 'false') {
      where.isRead = false;
    }

    if (query.search) {
      where.OR = [
        {
          title: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
        {
          message: {
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
      ];
    }


    const [alerts, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.buildAlertsOrderBy(query),
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

      this.prisma.alert.count({
        where,
      }),
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
   * @param body - DTO containing the alert information.
   * @param adminId - ID of the admin who created the alert.
   * @returns A success message and the created alert, or the broadcast count.
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