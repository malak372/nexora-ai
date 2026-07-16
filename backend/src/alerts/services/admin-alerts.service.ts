import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

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

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { CreateAlertDto } from '../dto/create-alert.dto';
import { CreateEmailAlertDto } from '../dto/create-email-alert.dto';
import { GetAlertsQueryDto } from '../dto/get-alerts-query.dto';

import { SystemAlertsService } from './system-alerts.service';

const EMAIL_BROADCAST_BATCH_SIZE = 10;

/**
 * Handles administrator alert operations.
 *
 * Supports:
 * - Retrieving and monitoring in-app alerts.
 * - Creating single-user in-app alerts.
 * - Broadcasting in-app alerts.
 * - Sending single-user email alerts.
 * - Broadcasting email alerts.
 * - Recording administrator operations in the audit log.
 *
 * In-app alert persistence is delegated to SystemAlertsService.
 *
 * @author Malak
 */
@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly systemAlertsService: SystemAlertsService,
  ) { }

  /**
   * Retrieves a paginated and filtered list of in-app alerts.
   */
  async getAlerts(query: GetAlertsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const search = query.search?.trim();

    const searchFilter: Prisma.AlertWhereInput = search
      ? {
        OR: [
          {
            title: {
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
   * Creates an in-app alert for one user or broadcasts
   * it to all eligible users.
   */
  async createAlert(
    body: CreateAlertDto,
    adminId: string,
  ) {
    const alertType = body.type ?? AlertType.SYSTEM;

    if (body.userId) {
      return this.createSingleUserAlert(
        body,
        body.userId,
        adminId,
        alertType,
      );
    }

    return this.createBroadcastAlert(
      body,
      adminId,
      alertType,
    );
  }

  /**
   * Sends an email alert to one user or broadcasts
   * it to all eligible users.
   */
  async sendEmailAlert(
    body: CreateEmailAlertDto,
    adminId: string,
  ) {
    if (body.userId) {
      return this.sendSingleUserEmailAlert(
        body,
        body.userId,
        adminId,
      );
    }

    return this.sendBroadcastEmailAlert(body, adminId);
  }

  /**
   * Creates an in-app alert for one active registered user.
   */
  private async createSingleUserAlert(
    body: CreateAlertDto,
    userId: string,
    adminId: string,
    alertType: AlertType,
  ) {
    const user = await this.findActiveRegisteredUser(userId);

    const title = body.title.trim();
    const message = body.message.trim();

    const alert = await this.prisma.$transaction(async (tx) => {
      const createdAlert = await this.systemAlertsService.create(
        {
          userId: user.id,
          title,
          message,
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
   * Broadcasts an in-app alert to all active registered users.
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

    const title = body.title.trim();
    const message = body.message.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      const creationResult =
        await this.systemAlertsService.createMany(
          users.map((user) => ({
            userId: user.id,
            title,
            message,
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
            title,
            message,
            type: alertType,
          },
        },
        tx,
      );

      return creationResult;
    });

    return {
      message: 'Alert broadcast completed successfully',
      totalUsers: users.length,
      sentCount: result.count,
    };
  }

  /**
   * Sends an email alert to one active registered user.
   */
  private async sendSingleUserEmailAlert(
    body: CreateEmailAlertDto,
    userId: string,
    adminId: string,
  ) {
    const user = await this.findActiveRegisteredUser(userId);

    const subject = body.subject.trim();
    const message = body.message.trim();

    await this.mailService.sendAdminAlertEmail(
      user.email,
      subject,
      message,
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
        subject,
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
   * Sends an email alert to all active registered users.
   *
   * Emails are processed in controlled batches to avoid
   * overwhelming the mail provider.
   *
   * A failed delivery does not stop the remaining deliveries.
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

    const subject = body.subject.trim();
    const message = body.message.trim();

    let sentCount = 0;
    let failedCount = 0;

    for (
      let index = 0;
      index < users.length;
      index += EMAIL_BROADCAST_BATCH_SIZE
    ) {
      const batch = users.slice(
        index,
        index + EMAIL_BROADCAST_BATCH_SIZE,
      );

      const results = await Promise.allSettled(
        batch.map((user) =>
          this.mailService.sendAdminAlertEmail(
            user.email,
            subject,
            message,
            user.fullName,
          ),
        ),
      );

      results.forEach((result, resultIndex) => {
        const user = batch[resultIndex];

        if (result.status === 'fulfilled') {
          sentCount += 1;
          return;
        }

        failedCount += 1;

        this.logger.error(
          `Failed to send administrator alert email to user ${user.id}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      });
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
        subject,
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
   * Retrieves one active registered user.
   *
   * Throws NotFoundException when the user does not exist,
   * is inactive, or is not a normal application user.
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