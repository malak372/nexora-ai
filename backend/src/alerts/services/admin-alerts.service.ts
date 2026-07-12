import { Injectable, NotFoundException } from '@nestjs/common';

import {
  AlertType,
  AuditAction,
  AuditTargetType,
  Prisma,
  UserRole,
} from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import { CreateAlertDto } from '../dto/create-alert.dto';
import { CreateEmailAlertDto } from '../dto/create-email-alert.dto';
import { GetAlertsQueryDto } from '../dto/get-alerts-query.dto';

import { SystemAlertsService } from './system-alerts.service';

/**
 * Service responsible for administrator alert operations.
 *
 * Supports:
 * - In-app alerts.
 * - Email alerts.
 * - Single-user alerts.
 * - Broadcast alerts.
 * - Alert monitoring.
 * - Audit logging.
 *
 * Actual in-app alert persistence is delegated to
 * SystemAlertsService.
 *
 * @author Malak
 */
@Injectable()
export class AdminAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly systemAlertsService: SystemAlertsService,
  ) {}

  /**
   * Retrieves alerts with filtering, searching,
   * sorting, and pagination.
   */
  async getAlerts(query: GetAlertsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const searchFilter: Prisma.AlertWhereInput = query.search?.trim()
      ? {
          OR: [
            {
              title: {
                contains: query.search.trim(),
                mode: 'insensitive',
              },
            },
            {
              message: {
                contains: query.search.trim(),
                mode: 'insensitive',
              },
            },
            {
              user: {
                fullName: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            },
            {
              user: {
                email: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            },
          ],
        }
      : {};

    const where: Prisma.AlertWhereInput = {
      ...(buildDateFilter(query) ?? {}),
      ...searchFilter,
      ...(buildExactFilter('type', query.type) ?? {}),
      ...(buildExactFilter('isRead', query.isRead) ?? {}),
    };

    const [alerts, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        skip,
        take,

        orderBy: buildOrderBy(
          query,
          ['title', 'type', 'isRead', 'createdAt'] as const,
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
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Creates one in-app alert or broadcasts it.
   */
  async createAlert(body: CreateAlertDto, adminId: string) {
    const alertType = body.type ?? AlertType.SYSTEM;

    if (body.userId) {
      return this.createSingleUserAlert(body, adminId, alertType);
    }

    return this.createBroadcastAlert(body, adminId, alertType);
  }

  /**
   * Sends one email alert or broadcasts it.
   */
  async sendEmailAlert(body: CreateEmailAlertDto, adminId: string) {
    if (body.userId) {
      return this.sendSingleUserEmailAlert(body, adminId);
    }

    return this.sendBroadcastEmailAlert(body, adminId);
  }

  /**
   * Creates an in-app alert for one active user.
   */
  private async createSingleUserAlert(
    body: CreateAlertDto,
    adminId: string,
    alertType: AlertType,
  ) {
    const user = await this.findActiveRegisteredUser(body.userId!);

    const alert = await this.prisma.$transaction(async (tx) => {
      const createdAlert = await this.systemAlertsService.create(
        {
          userId: user.id,
          title: body.title,
          message: body.message,
          type: alertType,
        },
        tx,
      );

      await this.auditService.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_CREATE_ALERT,
          targetType: AuditTargetType.ALERT,
          targetId: createdAlert.id,

          newValue: {
            id: createdAlert.id,
            userId: createdAlert.userId,
            title: createdAlert.title,
            message: createdAlert.message,
            type: createdAlert.type,
            isRead: createdAlert.isRead,
            createdAt: createdAlert.createdAt.toISOString(),
          },
        },
        tx,
      );

      return createdAlert;
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

    const result = await this.prisma.$transaction(async (tx) => {
      const creationResult = await this.systemAlertsService.createMany(
        users.map((user) => ({
          userId: user.id,
          title: body.title,
          message: body.message,
          type: alertType,
        })),
        tx,
      );

      await this.auditService.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_CREATE_ALERT,
          targetType: AuditTargetType.ALERT,
          targetId: 'BROADCAST',

          newValue: {
            broadcast: true,
            sentCount: creationResult.count,
            title: body.title.trim(),
            message: body.message.trim(),
            type: alertType,
          },
        },
        tx,
      );

      return creationResult;
    });

    return {
      message: 'Alert sent to all active users successfully',
      sentCount: result.count,
    };
  }

  /**
   * Sends an email alert to one active user.
   */
  private async sendSingleUserEmailAlert(
    body: CreateEmailAlertDto,
    adminId: string,
  ) {
    const user = await this.findActiveRegisteredUser(body.userId!);

    await this.mailService.sendAdminAlertEmail(
      user.email,
      body.subject.trim(),
      body.message.trim(),
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
        subject: body.subject.trim(),
        message: body.message.trim(),
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
   *
   * One failed email does not stop the remaining deliveries.
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
          body.subject.trim(),
          body.message.trim(),
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
        subject: body.subject.trim(),
        message: body.message.trim(),
      },
    });

    return {
      message: 'Email alert broadcast completed',
      totalUsers: users.length,
      sentCount,
      failedCount,
    };
  }

  /**
   * Finds one active registered user.
   */
  private async findActiveRegisteredUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        role: UserRole.USER,
        isActive: true,
      },

      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Active user not found');
    }

    return user;
  }
}
