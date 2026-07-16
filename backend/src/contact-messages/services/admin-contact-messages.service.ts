import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  ContactMessageStatus,
  Prisma,
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

import {
  buildCsv,
  calculateTotalPages,
} from '../../utilities/analytics/analytics.helper';

import { GetContactMessagesQueryDto } from '../dto/get-contact-messages-query.dto';
import { UpdateContactMessageDto } from '../dto/update-contact-message.dto';

import { resolveContactMessageStatus } from '../utils/contact-message-status.util';

/**
 * Handles administrator Contact Us message management.
 *
 * Responsibilities:
 * - List active messages.
 * - Search, filter, sort, and paginate messages.
 * - Generate summary statistics.
 * - Generate chart-ready analytics.
 * - Export filtered messages as CSV.
 * - Update status and administrator reply.
 * - Send reply emails.
 * - Record administrator audit events.
 *
 * Soft-deleted messages are excluded from normal administrator
 * operations, summaries, charts, and exports.
 *
 * @author Malak
 */
@Injectable()
export class AdminContactMessagesService {
  /**
   * Prevents one CSV request from loading an unlimited number
   * of records into application memory.
   */
  private static readonly MAX_CSV_EXPORT_ROWS = 50_000;

  /**
   * Records non-fatal email-delivery failures.
   */
  private readonly logger = new Logger(AdminContactMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Shared administrator-facing contact-message selection.
   */
  private readonly contactMessageSelect = {
    id: true,
    fullName: true,
    email: true,
    subject: true,
    message: true,
    status: true,
    adminReply: true,
    createdAt: true,
    updatedAt: true,

    user: {
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    },
  } satisfies Prisma.ContactMessageSelect;

  /**
   * Returns paginated active Contact Us messages.
   *
   * @param query Filtering, sorting, and pagination options.
   */
  async getContactMessages(query: GetContactMessagesQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildContactMessagesWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['status', 'createdAt', 'updatedAt'] as const,
      'createdAt',
    );

    const [messages, total] = await Promise.all([
      this.prisma.contactMessage.findMany({
        where,
        skip,
        take,
        orderBy,
        select: this.contactMessageSelect,
      }),

      this.prisma.contactMessage.count({
        where,
      }),
    ]);

    return {
      data: messages,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Returns summary statistics for active Contact Us messages.
   *
   * Additional summary conditions are combined using AND so they
   * do not overwrite filters supplied through the query DTO.
   *
   * @param query Contact-message filters.
   */
  async getContactMessagesSummary(query: GetContactMessagesQueryDto) {
    const where = this.buildContactMessagesWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      totalMessages,
      todayMessages,
      thisMonthMessages,
      newMessages,
      inProgressMessages,
      repliedMessages,
      closedMessages,
    ] = await Promise.all([
      this.prisma.contactMessage.count({
        where,
      }),

      this.prisma.contactMessage.count({
        where: this.andWhere(where, {
          createdAt: {
            gte: todayStart,
          },
        }),
      }),

      this.prisma.contactMessage.count({
        where: this.andWhere(where, {
          createdAt: {
            gte: monthStart,
          },
        }),
      }),

      this.prisma.contactMessage.count({
        where: this.andWhere(where, {
          status: ContactMessageStatus.NEW,
        }),
      }),

      this.prisma.contactMessage.count({
        where: this.andWhere(where, {
          status: ContactMessageStatus.IN_PROGRESS,
        }),
      }),

      this.prisma.contactMessage.count({
        where: this.andWhere(where, {
          status: ContactMessageStatus.REPLIED,
        }),
      }),

      this.prisma.contactMessage.count({
        where: this.andWhere(where, {
          status: ContactMessageStatus.CLOSED,
        }),
      }),
    ]);

    return {
      totalMessages,
      todayMessages,
      thisMonthMessages,
      newMessages,
      inProgressMessages,
      repliedMessages,
      closedMessages,
    };
  }

  /**
   * Returns chart-ready message counts grouped by status.
   *
   * @param query Contact-message filters.
   */
  async getContactMessagesCharts(query: GetContactMessagesQueryDto) {
    const where = this.buildContactMessagesWhere(query);

    const messagesByStatus = await this.prisma.contactMessage.groupBy({
      by: ['status'],
      where,
      _count: {
        status: true,
      },
      orderBy: {
        _count: {
          status: 'desc',
        },
      },
    });

    return {
      messagesByStatus: messagesByStatus.map((item) => ({
        label: item.status,
        status: item.status,
        count: item._count.status,
      })),
    };
  }

  /**
   * Exports filtered active Contact Us messages as CSV.
   *
   * @param query Contact-message filters and sorting options.
   */
  async exportContactMessagesCsv(query: GetContactMessagesQueryDto) {
    const where = this.buildContactMessagesWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['status', 'createdAt', 'updatedAt'] as const,
      'createdAt',
    );

    const messages = await this.prisma.contactMessage.findMany({
      where,
      orderBy,
      take: AdminContactMessagesService.MAX_CSV_EXPORT_ROWS,
      select: this.contactMessageSelect,
    });

    const headers = [
      'Contact Message ID',
      'Full Name',
      'Email',
      'Subject',
      'Message',
      'Status',
      'Admin Reply',
      'User ID',
      'User Name',
      'User Email',
      'Created At',
      'Updated At',
    ];

    const rows = messages.map((message) => [
      message.id,
      message.fullName,
      message.email,
      message.subject,
      message.message,
      message.status,
      message.adminReply ?? '',
      message.user?.id ?? '',
      message.user?.fullName ?? '',
      message.user?.email ?? '',
      message.createdAt.toISOString(),
      message.updatedAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Updates one active Contact Us message.
   *
   * Database update and audit logging are executed in one
   * transaction.
   *
   * Email delivery occurs only after the transaction succeeds.
   * An email failure does not undo the administrator's persisted
   * reply or audit record.
   *
   * The email is sent only when the administrator reply actually
   * changes to a new non-empty value.
   *
   * @param contactMessageId Contact-message identifier.
   * @param body Validated partial update.
   * @param adminId Authenticated administrator identifier.
   */
  async updateContactMessage(
    contactMessageId: string,
    body: UpdateContactMessageDto,
    adminId: string,
  ) {
    if (body.status === undefined && body.adminReply === undefined) {
      throw new BadRequestException(
        'At least one contact-message field must be provided',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const contactMessage = await tx.contactMessage.findFirst({
        where: {
          id: contactMessageId,
          deletedAt: null,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          subject: true,
          status: true,
          adminReply: true,
          updatedAt: true,
        },
      });

      if (!contactMessage) {
        throw new NotFoundException('Contact message not found');
      }

      const normalizedAdminReply = body.adminReply?.trim();

      const nextStatus = resolveContactMessageStatus(
        contactMessage.status,
        body.status,
        normalizedAdminReply,
      );

      const nextAdminReply =
        body.adminReply !== undefined
          ? normalizedAdminReply
          : contactMessage.adminReply;

      const replyChanged =
        body.adminReply !== undefined &&
        nextAdminReply !== contactMessage.adminReply;

      const hasChanges = nextStatus !== contactMessage.status || replyChanged;

      if (!hasChanges) {
        return {
          updated: false as const,
          replyChanged: false,
          message: 'No changes detected',
          contactMessage: {
            id: contactMessage.id,
            status: contactMessage.status,
            adminReply: contactMessage.adminReply,
            updatedAt: contactMessage.updatedAt,
          },
        };
      }

      const updated = await tx.contactMessage.update({
        where: {
          id: contactMessage.id,
        },
        data: {
          status: nextStatus,
          adminReply: nextAdminReply,
        },
        select: this.contactMessageSelect,
      });

      await this.auditService.createLog(
        {
          actorId: adminId,
          action: AuditAction.ADMIN_UPDATE_CONTACT_MESSAGE,
          targetType: AuditTargetType.CONTACT_MESSAGE,
          targetId: contactMessage.id,
          oldValue: {
            status: contactMessage.status,
            adminReply: contactMessage.adminReply,
          },
          newValue: {
            status: updated.status,
            adminReply: updated.adminReply,
          },
        },
        tx,
      );

      return {
        updated: true as const,
        replyChanged,
        message: 'Contact message updated successfully',
        contactMessage: updated,
      };
    });

    if (!result.updated) {
      return {
        ...result,
        emailSent: false,
      };
    }

    let emailSent = false;

    if (result.replyChanged && result.contactMessage.adminReply) {
      try {
        await this.mailService.sendContactReplyEmail(
          result.contactMessage.email,
          result.contactMessage.fullName,
          result.contactMessage.subject,
          result.contactMessage.adminReply,
        );

        emailSent = true;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(
          `Contact reply email failed for message ${result.contactMessage.id}: ${errorMessage}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    const { replyChanged: _replyChanged, ...response } = result;

    return {
      ...response,
      emailSent,
    };
  }

  /**
   * Builds the reusable administrator Contact Us filter.
   *
   * Soft-deleted messages are always excluded.
   *
   * @param query Contact-message query options.
   */
  private buildContactMessagesWhere(
    query: GetContactMessagesQueryDto,
  ): Prisma.ContactMessageWhereInput {
    const where: Prisma.ContactMessageWhereInput = {
      deletedAt: null,

      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter('status', query.status) ?? {}),
    };

    const search = query.search?.trim();

    if (search) {
      where.OR = [
        {
          fullName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          email: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          subject: {
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
          adminReply: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          user: {
            is: {
              OR: [
                {
                  fullName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
        },
      ];
    }

    return where;
  }

  /**
   * Combines one base Prisma filter with an additional condition.
   *
   * AND prevents additional summary conditions from overwriting
   * status, search, soft-delete, or date filters.
   */
  private andWhere(
    baseWhere: Prisma.ContactMessageWhereInput,
    additionalWhere: Prisma.ContactMessageWhereInput,
  ): Prisma.ContactMessageWhereInput {
    return {
      AND: [baseWhere, additionalWhere],
    };
  }
}
