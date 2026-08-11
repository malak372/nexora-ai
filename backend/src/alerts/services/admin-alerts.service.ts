import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  AdminCommunicationEmailStatus,
  AdminCommunicationScope,
  AdminCommunicationStatus,
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
import { GetSentCommunicationsQueryDto } from '../dto/get-sent-communications-query.dto';
import { SendAdminCommunicationDto } from '../dto/send-admin-communication.dto';

import { SystemAlertsService } from './system-alerts.service';

const EMAIL_BROADCAST_BATCH_SIZE = 10;
const MAX_STORED_EMAIL_ERROR_LENGTH = 4000;

type CommunicationRecipient = {
  id: string;
  fullName: string | null;
  email: string;
};

type DeliverCommunicationInput = {
  recipients: CommunicationRecipient[];
  scope: AdminCommunicationScope;
  title: string;
  message: string;
  sendInApp: boolean;
  sendEmail: boolean;
  adminId: string;
  alertType?: AlertType | null;
};

type SingleAlertResult = {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: AlertType;
  isRead: boolean;
  createdAt: Date;
};


type SentCommunicationRecipient = {
  id: string;
  recipientRecordId?: string;
  userId?: string | null;
  fullName: string | null;
  email: string;
  inAppDelivered: boolean;
  emailStatus: AdminCommunicationEmailStatus;
  emailError: string | null;
  emailSentAt: Date | null;
};

type SentCommunicationRecord = {
  id: string;
  title: string;
  message: string;
  scope: AdminCommunicationScope;
  status: AdminCommunicationStatus;
  recipientCount: number;
  alertType: AlertType | null;
  channels: {
    inApp: boolean;
    email: boolean;
  };
  channel: 'IN_APP' | 'EMAIL' | 'BOTH';
  delivery: {
    inAppDeliveredCount: number;
    emailSentCount: number;
    emailFailedCount: number;
  };
  actor: {
    id: string;
    fullName: string | null;
    email: string;
  } | null;
  createdAt: Date;
  completedAt: Date | null;
  recipients: SentCommunicationRecipient[];
  persisted: boolean;
  legacy: boolean;
};

/**
 * Handles administrator communication operations.
 *
 * Every administrator-sent communication is persisted in
 * AdminCommunication before delivery starts. Recipient snapshots and
 * per-channel delivery results are stored in AdminCommunicationRecipient.
 *
 * This ensures that:
 * - Email-only messages are still visible in Sent communications.
 * - The exact message body is preserved.
 * - Recipient names/emails remain inspectable even if the user later changes them.
 * - Email failures are stored per recipient.
 * - In-app and email delivery totals are stored permanently.
 *
 * @author Eman
 */
@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly systemAlertsService: SystemAlertsService,
  ) {}

  /**
   * Builds the shared Prisma filter for administrator alert activity.
   */
  private buildAlertsWhere(
    query: GetAlertsQueryDto,
    includeReadFilter = true,
  ): Prisma.AlertWhereInput {
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

    return {
      ...(buildDateFilter(query) ?? {}),
      ...searchFilter,
      ...(buildExactFilter('type', query.type) ?? {}),
      ...(includeReadFilter
        ? (buildExactFilter('isRead', query.isRead) ?? {})
        : {}),
    };
  }

  /**
   * Returns aggregate counters for the in-app alert activity workspace.
   */
  async getAlertsSummary(query: GetAlertsQueryDto) {
    const where = this.buildAlertsWhere(query, false);

    const [
      totalAlerts,
      unreadAlerts,
      readAlerts,
      adminAlerts,
      systemAlerts,
      recipients,
    ] = await Promise.all([
      this.prisma.alert.count({ where }),
      this.prisma.alert.count({
        where: {
          ...where,
          isRead: false,
        },
      }),
      this.prisma.alert.count({
        where: {
          ...where,
          isRead: true,
        },
      }),
      this.prisma.alert.count({
        where: {
          ...where,
          type: AlertType.ADMIN,
        },
      }),
      this.prisma.alert.count({
        where: {
          ...where,
          type: AlertType.SYSTEM,
        },
      }),
      this.prisma.alert.findMany({
        where,
        select: {
          userId: true,
        },
        distinct: ['userId'],
      }),
    ]);

    return {
      totalAlerts,
      unreadAlerts,
      readAlerts,
      adminAlerts,
      systemAlerts,
      uniqueRecipients: recipients.length,
    };
  }

  /**
   * Retrieves paginated in-app alert activity.
   */
  async getAlerts(query: GetAlertsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildAlertsWhere(query);

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
   * Sends one persisted administrator communication.
   *
   * Exactly one recipient mode must be selected:
   * - userIds for selected users.
   * - broadcast for all active users.
   */
  async sendCommunication(
    body: SendAdminCommunicationDto,
    adminId: string,
  ) {
    if (!body.sendInApp && !body.sendEmail) {
      throw new BadRequestException(
        'Select at least one delivery channel.',
      );
    }

    const recipients = await this.resolveCommunicationRecipients(body);

    const result = await this.deliverCommunication({
      recipients,
      scope: body.broadcast
        ? AdminCommunicationScope.BROADCAST
        : AdminCommunicationScope.SELECTED,
      title: body.title.trim(),
      message: body.message.trim(),
      sendInApp: body.sendInApp,
      sendEmail: body.sendEmail,
      adminId,
      alertType: body.sendInApp ? AlertType.ADMIN : null,
    });

    return {
      message:
        result.status === AdminCommunicationStatus.PARTIAL
          ? 'Communication delivered with some failures'
          : result.status === AdminCommunicationStatus.FAILED
            ? 'Communication delivery failed'
            : 'Communication delivered successfully',
      communicationId: result.communicationId,
      scope: result.scope,
      recipientCount: recipients.length,
      status: result.status,
      channels: {
        inApp: body.sendInApp,
        email: body.sendEmail,
      },
      delivery: {
        inApp: {
          requested: body.sendInApp,
          deliveredCount: result.inAppDeliveredCount,
        },
        email: {
          requested: body.sendEmail,
          sentCount: result.emailSentCount,
          failedCount: result.emailFailedCount,
          failedUserIds: result.failedUserIds,
        },
      },
    };
  }

  /**
   * Returns durable administrator-sent communication history.
   *
   * Unlike the previous audit-log fallback, this endpoint reads from
   * AdminCommunication, where the complete message and delivery metadata
   * are intentionally persisted.
   */
  async getSentCommunications(query: GetSentCommunicationsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    /*
     * New communications are stored in AdminCommunication.
     *
     * Historical sends created before AdminCommunication existed are still
     * present in AuditLog. We merge both sources here so an administrator
     * does not lose visibility of messages that were sent before the new
     * durable communication table was introduced.
     */
    const [persistentRows, legacyAuditRows] = await Promise.all([
      this.prisma.adminCommunication.findMany({
        where: this.buildSentCommunicationWhere(query),

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          recipients: {
            orderBy: [
              {
                fullNameSnapshot: 'asc',
              },
              {
                emailSnapshot: 'asc',
              },
            ],
            take: 50,

            select: {
              id: true,
              userId: true,
              fullNameSnapshot: true,
              emailSnapshot: true,
              inAppDelivered: true,
              emailStatus: true,
              emailError: true,
              emailSentAt: true,
            },
          },
        },
      }),

      this.prisma.auditLog.findMany({
        where: {
          action: AuditAction.ADMIN_CREATE_ALERT,
          targetType: AuditTargetType.ALERT,
          ...(buildDateFilter(query) ?? {}),
        },

        orderBy: {
          createdAt: 'desc',
        },

        take: 5000,

        include: {
          actor: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    const persistent = persistentRows.map((row) =>
      this.mapCommunicationRow(row),
    );

    const persistentIds = new Set(
      persistent.map((row) => row.id),
    );

    const legacyUserIds = new Set<string>();

    legacyAuditRows.forEach((row) => {
      const value = this.asJsonObject(row.newValue);

      if (typeof value.userId === 'string') {
        legacyUserIds.add(value.userId);
      }

      if (Array.isArray(value.recipients)) {
        value.recipients.forEach((recipientValue) => {
          const recipient = this.asJsonObject(
            recipientValue as Prisma.JsonValue,
          );

          if (typeof recipient.id === 'string') {
            legacyUserIds.add(recipient.id);
          }
        });
      }
    });

    const currentUsers =
      legacyUserIds.size > 0
        ? await this.prisma.user.findMany({
            where: {
              id: {
                in: [...legacyUserIds],
              },
            },

            select: {
              id: true,
              fullName: true,
              email: true,
            },
          })
        : [];

    const currentUserMap = new Map(
      currentUsers.map((user) => [user.id, user]),
    );

    const legacy = legacyAuditRows
      .filter((row) => {
        const value = this.asJsonObject(row.newValue);

        /*
         * Current durable sends also create an audit record. Do not show
         * those records twice.
         */
        if (value.persistent === true) {
          return false;
        }

        if (
          typeof value.communicationId === 'string' &&
          persistentIds.has(value.communicationId)
        ) {
          return false;
        }

        /*
         * The optional historical backfill used the audit id itself as the
         * AdminCommunication id. This check also prevents those rows from
         * appearing twice.
         */
        if (persistentIds.has(row.id)) {
          return false;
        }

        return true;
      })
      .map((row) =>
        this.mapLegacyCommunicationAudit(
          row,
          currentUserMap,
        ),
      )
      .filter(
        (row): row is SentCommunicationRecord => row !== null,
      );

    const merged = [...persistent, ...legacy]
      .filter((row) => this.matchesSentCommunicationFilters(row, query));

    this.sortSentCommunications(merged, query);

    const total = merged.length;
    const data = merged.slice(skip, skip + take);

    return {
      data,

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Legacy in-app endpoint.
   *
   * It now uses the same durable communication persistence as the unified
   * sender so messages created through older callers are not lost.
   */
  async createAlert(body: CreateAlertDto, adminId: string) {
    const alertType = body.type ?? AlertType.SYSTEM;

    const recipients = body.userId
      ? [await this.findActiveRegisteredUser(body.userId)]
      : await this.findAllActiveRegisteredUsers();

    const result = await this.deliverCommunication({
      recipients,
      scope: body.userId
        ? AdminCommunicationScope.SELECTED
        : AdminCommunicationScope.BROADCAST,
      title: body.title.trim(),
      message: body.message.trim(),
      sendInApp: true,
      sendEmail: false,
      adminId,
      alertType,
    });

    if (body.userId) {
      return {
        message: 'Alert sent successfully',
        alert: result.singleAlert ?? null,
        communicationId: result.communicationId,
      };
    }

    return {
      message: 'Alert broadcast completed successfully',
      totalUsers: recipients.length,
      sentCount: result.inAppDeliveredCount,
      communicationId: result.communicationId,
    };
  }

  /**
   * Legacy email endpoint.
   *
   * The email subject, complete body, recipient snapshot and delivery
   * result are now persisted before this method returns.
   */
  async sendEmailAlert(body: CreateEmailAlertDto, adminId: string) {
    const recipients = body.userId
      ? [await this.findActiveRegisteredUser(body.userId)]
      : await this.findAllActiveRegisteredUsers();

    const result = await this.deliverCommunication({
      recipients,
      scope: body.userId
        ? AdminCommunicationScope.SELECTED
        : AdminCommunicationScope.BROADCAST,
      title: body.subject.trim(),
      message: body.message.trim(),
      sendInApp: false,
      sendEmail: true,
      adminId,
      alertType: null,
    });

    if (body.userId) {
      return {
        message:
          result.emailFailedCount > 0
            ? 'Email alert delivery failed'
            : 'Email alert sent successfully',
        communicationId: result.communicationId,

        user: {
          id: recipients[0].id,
          fullName: recipients[0].fullName,
          email: recipients[0].email,
        },

        delivery: {
          sentCount: result.emailSentCount,
          failedCount: result.emailFailedCount,
        },
      };
    }

    return {
      message: 'Email alert broadcast completed',
      communicationId: result.communicationId,
      totalUsers: recipients.length,
      sentCount: result.emailSentCount,
      failedCount: result.emailFailedCount,
    };
  }

  /**
   * Shared durable delivery pipeline for every administrator communication.
   *
   * Persistence order:
   * 1. Store communication + recipient snapshots.
   * 2. Persist in-app alerts when requested.
   * 3. Send emails in controlled batches.
   * 4. Persist per-recipient email outcomes.
   * 5. Finalize aggregate delivery counters.
   * 6. Write an audit record that points to the durable communication row.
   */
  private async deliverCommunication(
    input: DeliverCommunicationInput,
  ) {
    if (input.recipients.length === 0) {
      throw new BadRequestException(
        'No active recipients are available for this communication.',
      );
    }

    const title = input.title.trim();
    const message = input.message.trim();

    if (!title) {
      throw new BadRequestException('Communication title is required.');
    }

    if (!message) {
      throw new BadRequestException('Communication message is required.');
    }

    let singleAlert: SingleAlertResult | null = null;

    const persisted = await this.prisma.$transaction(async (tx) => {
      const communication = await tx.adminCommunication.create({
        data: {
          actorId: input.adminId,
          title,
          message,
          scope: input.scope,
          sendInApp: input.sendInApp,
          sendEmail: input.sendEmail,
          alertType: input.alertType ?? null,
          recipientCount: input.recipients.length,
          status: AdminCommunicationStatus.PENDING,

          recipients: {
            create: input.recipients.map((recipient) => ({
              userId: recipient.id,
              fullNameSnapshot: recipient.fullName,
              emailSnapshot: recipient.email,
              inAppDelivered: false,
              emailStatus: input.sendEmail
                ? AdminCommunicationEmailStatus.PENDING
                : AdminCommunicationEmailStatus.NOT_REQUESTED,
            })),
          },
        },
      });

      let inAppDeliveredCount = 0;

      if (input.sendInApp) {
        if (input.recipients.length === 1) {
          const createdAlert = await this.systemAlertsService.create(
            {
              userId: input.recipients[0].id,
              title,
              message,
              type: input.alertType ?? AlertType.ADMIN,
            },
            tx,
          );

          singleAlert = createdAlert;
          inAppDeliveredCount = 1;
        } else {
          const creationResult = await this.systemAlertsService.createMany(
            input.recipients.map((recipient) => ({
              userId: recipient.id,
              title,
              message,
              type: input.alertType ?? AlertType.ADMIN,
            })),
            tx,
          );

          inAppDeliveredCount = creationResult.count;
        }

        if (inAppDeliveredCount === input.recipients.length) {
          await tx.adminCommunicationRecipient.updateMany({
            where: {
              communicationId: communication.id,
            },
            data: {
              inAppDelivered: true,
            },
          });
        }
      }

      await tx.adminCommunication.update({
        where: {
          id: communication.id,
        },
        data: {
          inAppDeliveredCount,
        },
      });

      return {
        communicationId: communication.id,
        inAppDeliveredCount,
      };
    });

    let emailSentCount = 0;
    let emailFailedCount = 0;
    const failedUserIds: string[] = [];

    if (input.sendEmail) {
      for (
        let index = 0;
        index < input.recipients.length;
        index += EMAIL_BROADCAST_BATCH_SIZE
      ) {
        const batch = input.recipients.slice(
          index,
          index + EMAIL_BROADCAST_BATCH_SIZE,
        );

        const results = await Promise.allSettled(
          batch.map((recipient) =>
            this.mailService.sendAdminAlertEmail(
              recipient.email,
              title,
              message,
              recipient.fullName ?? undefined,
            ),
          ),
        );

        const recipientUpdates = results.map((result, resultIndex) => {
          const recipient = batch[resultIndex];

          if (result.status === 'fulfilled') {
            emailSentCount += 1;

            return this.prisma.adminCommunicationRecipient.updateMany({
              where: {
                communicationId: persisted.communicationId,
                userId: recipient.id,
              },
              data: {
                emailStatus: AdminCommunicationEmailStatus.SENT,
                emailError: null,
                emailSentAt: new Date(),
              },
            });
          }

          emailFailedCount += 1;
          failedUserIds.push(recipient.id);

          const errorText = this.getDeliveryErrorText(result.reason);

          this.logger.error(
            `Failed to send administrator communication email to user ${recipient.id}`,
            result.reason instanceof Error
              ? result.reason.stack
              : errorText,
          );

          return this.prisma.adminCommunicationRecipient.updateMany({
            where: {
              communicationId: persisted.communicationId,
              userId: recipient.id,
            },
            data: {
              emailStatus: AdminCommunicationEmailStatus.FAILED,
              emailError: errorText,
              emailSentAt: null,
            },
          });
        });

        await this.prisma.$transaction(recipientUpdates);
      }
    }

    const requestedDeliveryCount =
      input.recipients.length *
      Number(input.sendInApp) +
      input.recipients.length *
      Number(input.sendEmail);

    const successfulDeliveryCount =
      persisted.inAppDeliveredCount +
      emailSentCount;

    const status =
      successfulDeliveryCount === requestedDeliveryCount
        ? AdminCommunicationStatus.COMPLETED
        : successfulDeliveryCount === 0
          ? AdminCommunicationStatus.FAILED
          : AdminCommunicationStatus.PARTIAL;

    await this.prisma.$transaction(async (tx) => {
      await tx.adminCommunication.update({
        where: {
          id: persisted.communicationId,
        },
        data: {
          status,
          inAppDeliveredCount: persisted.inAppDeliveredCount,
          emailSentCount,
          emailFailedCount,
          completedAt: new Date(),
        },
      });

      await this.auditService.createLog(
        {
          actorId: input.adminId,
          action: AuditAction.ADMIN_CREATE_ALERT,
          targetType: AuditTargetType.ALERT,
          targetId: persisted.communicationId,

          newValue: {
            adminCommunication: true,
            persistent: true,
            communicationId: persisted.communicationId,
            scope: input.scope,
            title,
            message,
            alertType: input.alertType ?? null,
            channels: {
              inApp: input.sendInApp,
              email: input.sendEmail,
            },
            recipientCount: input.recipients.length,
            delivery: {
              inAppDeliveredCount: persisted.inAppDeliveredCount,
              emailSentCount,
              emailFailedCount,
              failedUserIds,
            },
            status,
          },
        },
        tx,
      );
    });

    return {
      communicationId: persisted.communicationId,
      scope: input.scope,
      status,
      singleAlert,
      inAppDeliveredCount: persisted.inAppDeliveredCount,
      emailSentCount,
      emailFailedCount,
      failedUserIds,
    };
  }

  /**
   * Builds a Prisma filter for durable sent communication history.
   */
  private buildSentCommunicationWhere(
    query: GetSentCommunicationsQueryDto,
  ): Prisma.AdminCommunicationWhereInput {
    const search = query.search?.trim();

    const where: Prisma.AdminCommunicationWhereInput = {
      ...(buildDateFilter(query) ?? {}),

      ...(query.scope
        ? {
            scope: query.scope as AdminCommunicationScope,
          }
        : {}),

      ...(search
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
                actor: {
                  fullName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                actor: {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                recipients: {
                  some: {
                    OR: [
                      {
                        fullNameSnapshot: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        emailSnapshot: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    if (query.channel === 'IN_APP') {
      where.sendInApp = true;
      where.sendEmail = false;
    }

    if (query.channel === 'EMAIL') {
      where.sendInApp = false;
      where.sendEmail = true;
    }

    if (query.channel === 'BOTH') {
      where.sendInApp = true;
      where.sendEmail = true;
    }

    return where;
  }

  /**
   * Converts an unknown Prisma JSON value into a plain object.
   */
  private asJsonObject(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  /**
   * Normalizes historical ADMIN_CREATE_ALERT audit rows.
   *
   * Older in-app sends stored title + message in AuditLog, so they can be
   * reconstructed exactly. Very old email-only sends stored the subject but
   * not the body; those records remain visible, but their missing historical
   * body cannot be recreated.
   */
  private mapLegacyCommunicationAudit(
    row: {
      id: string;
      newValue: Prisma.JsonValue | null;
      targetId: string | null;
      createdAt: Date;
      actor: {
        id: string;
        fullName: string | null;
        email: string;
      } | null;
    },
    currentUserMap: Map<
      string,
      {
        id: string;
        fullName: string | null;
        email: string;
      }
    >,
  ): SentCommunicationRecord | null {
    const value = this.asJsonObject(row.newValue);

    const hasKnownCommunicationShape =
      value.adminCommunication === true ||
      value.emailAlert === true ||
      value.broadcast === true ||
      typeof value.userId === 'string' ||
      typeof value.title === 'string' ||
      typeof value.subject === 'string';

    if (!hasKnownCommunicationShape) {
      return null;
    }

    const channelsValue = this.asJsonObject(
      value.channels as Prisma.JsonValue | undefined,
    );

    const deliveryValue = this.asJsonObject(
      value.delivery as Prisma.JsonValue | undefined,
    );

    const nestedInAppDelivery = this.asJsonObject(
      deliveryValue.inApp as Prisma.JsonValue | undefined,
    );

    const nestedEmailDelivery = this.asJsonObject(
      deliveryValue.email as Prisma.JsonValue | undefined,
    );

    const isLegacyEmail = value.emailAlert === true;

    const sendInApp =
      typeof channelsValue.inApp === 'boolean'
        ? channelsValue.inApp
        : !isLegacyEmail;

    const sendEmail =
      typeof channelsValue.email === 'boolean'
        ? channelsValue.email
        : isLegacyEmail;

    const title =
      typeof value.title === 'string'
        ? value.title
        : typeof value.subject === 'string'
          ? value.subject
          : 'Administrator communication';

    const message =
      typeof value.message === 'string' && value.message.trim()
        ? value.message
        : isLegacyEmail
          ? 'This email was sent before full message-body storage was enabled.'
          : '';

    if (!title.trim() && !message.trim()) {
      return null;
    }

    const scope =
      value.scope === 'BROADCAST' || value.broadcast === true
        ? AdminCommunicationScope.BROADCAST
        : AdminCommunicationScope.SELECTED;

    const recipients: SentCommunicationRecipient[] = [];

    if (Array.isArray(value.recipients)) {
      value.recipients.forEach((recipientValue, index) => {
        const recipient = this.asJsonObject(
          recipientValue as Prisma.JsonValue,
        );

        const userId =
          typeof recipient.id === 'string'
            ? recipient.id
            : null;

        const currentUser = userId
          ? currentUserMap.get(userId)
          : undefined;

        const fullName =
          typeof recipient.fullName === 'string'
            ? recipient.fullName
            : currentUser?.fullName ?? null;

        const email =
          typeof recipient.email === 'string'
            ? recipient.email
            : currentUser?.email ?? '';

        recipients.push({
          id: userId ?? `${row.id}:recipient:${index}`,
          userId,
          fullName,
          email,
          inAppDelivered: sendInApp,
          emailStatus: sendEmail
            ? AdminCommunicationEmailStatus.SENT
            : AdminCommunicationEmailStatus.NOT_REQUESTED,
          emailError: null,
          emailSentAt: sendEmail ? row.createdAt : null,
        });
      });
    } else if (typeof value.userId === 'string') {
      const currentUser = currentUserMap.get(value.userId);

      recipients.push({
        id: value.userId,
        userId: value.userId,
        fullName: currentUser?.fullName ?? null,
        email: currentUser?.email ?? '',
        inAppDelivered: sendInApp,
        emailStatus: sendEmail
          ? AdminCommunicationEmailStatus.SENT
          : AdminCommunicationEmailStatus.NOT_REQUESTED,
        emailError: null,
        emailSentAt: sendEmail ? row.createdAt : null,
      });
    }

    const recipientCount =
      typeof value.recipientCount === 'number'
        ? value.recipientCount
        : typeof value.sentCount === 'number'
          ? value.sentCount
          : typeof value.totalUsers === 'number'
            ? value.totalUsers
            : recipients.length || 1;

    const inAppDeliveredCount =
      typeof nestedInAppDelivery.deliveredCount === 'number'
        ? nestedInAppDelivery.deliveredCount
        : typeof deliveryValue.inAppDeliveredCount === 'number'
          ? deliveryValue.inAppDeliveredCount
          : sendInApp
            ? recipientCount
            : 0;

    const emailSentCount =
      typeof nestedEmailDelivery.sentCount === 'number'
        ? nestedEmailDelivery.sentCount
        : typeof deliveryValue.emailSentCount === 'number'
          ? deliveryValue.emailSentCount
          : sendEmail
            ? typeof value.sentCount === 'number'
              ? value.sentCount
              : recipientCount
            : 0;

    const emailFailedCount =
      typeof nestedEmailDelivery.failedCount === 'number'
        ? nestedEmailDelivery.failedCount
        : typeof deliveryValue.emailFailedCount === 'number'
          ? deliveryValue.emailFailedCount
          : typeof value.failedCount === 'number'
            ? value.failedCount
            : 0;

    const successfulDeliveryCount =
      inAppDeliveredCount + emailSentCount;

    const requestedDeliveryCount =
      recipientCount * Number(sendInApp) +
      recipientCount * Number(sendEmail);

    const status =
      successfulDeliveryCount === 0 && requestedDeliveryCount > 0
        ? AdminCommunicationStatus.FAILED
        : successfulDeliveryCount < requestedDeliveryCount ||
            emailFailedCount > 0
          ? AdminCommunicationStatus.PARTIAL
          : AdminCommunicationStatus.COMPLETED;

    const rawAlertType =
      typeof value.alertType === 'string'
        ? value.alertType
        : typeof value.type === 'string'
          ? value.type
          : null;

    const alertType =
      rawAlertType &&
      Object.values(AlertType).includes(rawAlertType as AlertType)
        ? (rawAlertType as AlertType)
        : null;

    return {
      id: `legacy:${row.id}`,
      title,
      message,
      scope,
      status,
      recipientCount,
      alertType,
      channels: {
        inApp: sendInApp,
        email: sendEmail,
      },
      channel:
        sendInApp && sendEmail
          ? 'BOTH'
          : sendEmail
            ? 'EMAIL'
            : 'IN_APP',
      delivery: {
        inAppDeliveredCount,
        emailSentCount,
        emailFailedCount,
      },
      actor: row.actor,
      createdAt: row.createdAt,
      completedAt: row.createdAt,
      recipients:
        scope === AdminCommunicationScope.SELECTED
          ? recipients
          : [],
      persisted: false,
      legacy: true,
    };
  }

  /**
   * Applies frontend history filters to both durable and legacy records.
   */
  private matchesSentCommunicationFilters(
    row: SentCommunicationRecord,
    query: GetSentCommunicationsQueryDto,
  ): boolean {
    if (
      query.channel &&
      row.channel !== query.channel
    ) {
      return false;
    }

    if (
      query.scope &&
      row.scope !== query.scope
    ) {
      return false;
    }

    const search = query.search?.trim().toLowerCase();

    if (!search) {
      return true;
    }

    const haystack = [
      row.title,
      row.message,
      row.actor?.fullName,
      row.actor?.email,
      ...row.recipients.flatMap((recipient) => [
        recipient.fullName,
        recipient.email,
      ]),
    ]
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .join(' ')
      .toLowerCase();

    return haystack.includes(search);
  }

  /**
   * Applies stable sorting after durable and legacy records are merged.
   */
  private sortSentCommunications(
    rows: SentCommunicationRecord[],
    query: GetSentCommunicationsQueryDto,
  ): void {
    const direction = query.sortOrder === 'asc' ? 1 : -1;

    rows.sort((left, right) => {
      switch (query.sortBy) {
        case 'title':
          return left.title.localeCompare(right.title) * direction;

        case 'recipientCount':
          return (
            (left.recipientCount - right.recipientCount) *
            direction
          );

        case 'status':
          return (
            String(left.status).localeCompare(String(right.status)) *
            direction
          );

        case 'createdAt':
        default:
          return (
            (left.createdAt.getTime() - right.createdAt.getTime()) *
            direction
          );
      }
    });
  }

  /**
   * Maps the persistent Prisma row into the frontend communication shape.
   */
  private mapCommunicationRow(
    row: Prisma.AdminCommunicationGetPayload<{
      include: {
        actor: {
          select: {
            id: true;
            fullName: true;
            email: true;
          };
        };
        recipients: {
          select: {
            id: true;
            userId: true;
            fullNameSnapshot: true;
            emailSnapshot: true;
            inAppDelivered: true;
            emailStatus: true;
            emailError: true;
            emailSentAt: true;
          };
        };
      };
    }>,
  ): SentCommunicationRecord {
    const channel =
      row.sendInApp && row.sendEmail
        ? 'BOTH'
        : row.sendEmail
          ? 'EMAIL'
          : 'IN_APP';

    return {
      id: row.id,
      title: row.title,
      message: row.message,
      scope: row.scope,
      status: row.status,
      recipientCount: row.recipientCount,
      alertType: row.alertType,
      channels: {
        inApp: row.sendInApp,
        email: row.sendEmail,
      },
      channel,
      delivery: {
        inAppDeliveredCount: row.inAppDeliveredCount,
        emailSentCount: row.emailSentCount,
        emailFailedCount: row.emailFailedCount,
      },
      actor: row.actor,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      recipients:
        row.scope === AdminCommunicationScope.SELECTED
          ? row.recipients.map((recipient) => ({
              id: recipient.userId ?? recipient.id,
              recipientRecordId: recipient.id,
              userId: recipient.userId,
              fullName: recipient.fullNameSnapshot,
              email: recipient.emailSnapshot,
              inAppDelivered: recipient.inAppDelivered,
              emailStatus: recipient.emailStatus,
              emailError: recipient.emailError,
              emailSentAt: recipient.emailSentAt,
            }))
          : [],
      persisted: true,
      legacy: false,
    };
  }

  /**
   * Resolves recipients for the unified send DTO.
   */
  private async resolveCommunicationRecipients(
    body: SendAdminCommunicationDto,
  ): Promise<CommunicationRecipient[]> {
    const requestedIds = [
      ...new Set((body.userIds ?? []).map((id) => id.trim())),
    ];

    const hasSelectedUsers = requestedIds.length > 0;
    const isBroadcast = body.broadcast === true;

    if (hasSelectedUsers === isBroadcast) {
      throw new BadRequestException(
        'Choose selected users or all active users, but not both.',
      );
    }

    if (isBroadcast) {
      return this.findAllActiveRegisteredUsers();
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: requestedIds,
        },
        role: UserRole.USER,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (users.length !== requestedIds.length) {
      throw new BadRequestException(
        'One or more selected users are inactive or unavailable.',
      );
    }

    const userById = new Map(users.map((user) => [user.id, user]));

    return requestedIds.map((id) => {
      const user = userById.get(id);

      if (!user) {
        throw new BadRequestException(
          'One or more selected users are inactive or unavailable.',
        );
      }

      return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
      };
    });
  }

  /**
   * Retrieves every active registered application user.
   */
  private findAllActiveRegisteredUsers() {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.USER,
        isActive: true,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
      orderBy: [
        {
          fullName: 'asc',
        },
        {
          email: 'asc',
        },
      ],
    });
  }

  /**
   * Retrieves one active registered application user.
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

  /**
   * Produces a bounded error message safe to persist in the database.
   */
  private getDeliveryErrorText(error: unknown): string {
    const text =
      error instanceof Error
        ? error.message
        : String(error ?? 'Unknown email delivery error');

    return text.slice(0, MAX_STORED_EMAIL_ERROR_LENGTH);
  }
}