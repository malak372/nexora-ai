import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AlertType,
  AuditAction,
  AuditTargetType,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit-logs/audit-logs.service';
import { MailService } from '../../mail/mail.service';

import { CreateAlertDto } from './dto/create-alert.dto';
import { CreateEmailAlertDto } from './dto/create-email-alert.dto';
import { GetAlertsQueryDto } from './dto/get-alerts-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for admin alert management operations.
 *
 * Supports:
 * - In-app alerts.
 * - Email alerts.
 * - Single user alerts.
 * - Broadcast alerts.
 * - General audit logging through AuditService.
 *
 * @author Malak
 */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Retrieves alerts with optional filtering, searching,
   * sorting, and pagination.
   */
  async getAlerts(query: GetAlertsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const searchFilter: Prisma.AlertWhereInput = query.search
      ? {
          OR: [
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
          ],
        }
      : {};

    const where: Prisma.AlertWhereInput = {
      ...buildDateFilter(query),
      ...searchFilter,
      ...buildExactFilter('type', query.type),
      ...buildExactFilter('isRead', query.isRead),
    };

    const [alerts, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(
          query,
          ['title', 'type', 'isRead', 'createdAt'],
          'createdAt',
        ),
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
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Creates and sends an in-app alert.
   */
  async createAlert(body: CreateAlertDto, adminId: string) {
    const alertType = body.type ?? AlertType.SYSTEM;

    if (body.userId) {
      return this.createSingleUserAlert(body, adminId, alertType);
    }

    return this.createBroadcastAlert(body, adminId, alertType);
  }

  /**
   * Sends an email alert separately from in-app alerts.
   */
  async sendEmailAlert(body: CreateEmailAlertDto, adminId: string) {
    if (body.userId) {
      return this.sendSingleUserEmailAlert(body, adminId);
    }

    return this.sendBroadcastEmailAlert(body, adminId);
  }

  /**
   * Creates an in-app alert for a specific active user.
   */
  private async createSingleUserAlert(
    body: CreateAlertDto,
    adminId: string,
    alertType: AlertType,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: body.userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive || user.role !== UserRole.USER) {
      throw new NotFoundException('Active user not found');
    }

    const alert = await this.prisma.alert.create({
      data: {
        userId: user.id,
        title: body.title,
        message: body.message,
        type: alertType,
      },
    });

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_CREATE_ALERT,
      targetType: AuditTargetType.ALERT,
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

  /**
   * Broadcasts an in-app alert to all active users.
   */
  private async createBroadcastAlert(
    body: CreateAlertDto,
    adminId: string,
    alertType: AlertType,
  ) {
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

    if (alertsData.length > 0) {
      await this.prisma.alert.createMany({
        data: alertsData,
      });
    }

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_CREATE_ALERT,
      targetType: AuditTargetType.ALERT,
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

  /**
   * Sends an email alert to one active user.
   */
  private async sendSingleUserEmailAlert(
    body: CreateEmailAlertDto,
    adminId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: body.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        isActive: true,
        role: true,
      },
    });

    if (!user || !user.isActive || user.role !== UserRole.USER) {
      throw new NotFoundException('Active user not found');
    }

    await this.mailService.sendAdminAlertEmail(
      user.email,
      body.subject,
      body.message,
      user.fullName,
    );

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_CREATE_ALERT,
      targetType: AuditTargetType.ALERT,
      targetId: user.id,
      newValue: {
        emailAlert: true,
        broadcast: false,
        userId: user.id,
        email: user.email,
        subject: body.subject,
        message: body.message,
      },
    });

    return {
      message: 'Email alert sent successfully',
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      },
    };
  }

  /**
   * Sends an email alert to all active users.
   */
  private async sendBroadcastEmailAlert(
    body: CreateEmailAlertDto,
    adminId: string,
  ) {
    const users = await this.prisma.user.findMany({
      where: {
        role: UserRole.USER,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    let sentCount = 0;
    let failedCount = 0;

    for (const user of users) {
      try {
        await this.mailService.sendAdminAlertEmail(
          user.email,
          body.subject,
          body.message,
          user.fullName,
        );

        sentCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    await this.auditService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_CREATE_ALERT,
      targetType: AuditTargetType.ALERT,
      targetId: 'BROADCAST_EMAIL',
      newValue: {
        emailAlert: true,
        broadcast: true,
        totalUsers: users.length,
        sentCount,
        failedCount,
        subject: body.subject,
        message: body.message,
      },
    });

    return {
      message: 'Email alert broadcast completed',
      totalUsers: users.length,
      sentCount,
      failedCount,
    };
  }
}
