import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  ContactMessageStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit-logs/audit-logs.service';
import { MailService } from '../../mail/mail.service';

import { GetContactMessagesQueryDto } from './dto/get-contact-messages-query.dto';
import { UpdateContactMessageDto } from './dto/update-contact-message.dto';
import { buildContactMessageStatus } from './utils/contact-messages.rules';

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

/**
 * Service responsible for managing Contact Us messages in the admin panel.
 *
 * Provides:
 * - Listing contact messages with pagination, filtering, searching, and sorting.
 * - Summary statistics.
 * - Chart-ready analytics.
 * - CSV export.
 * - Updating status and admin reply.
 * - Audit logging for admin updates.
 *
 * @author Malak
 */
@Injectable()
export class ContactMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditService,
    private readonly mailService: MailService,
  ) { }

  /**
   * Builds a reusable Prisma where filter for contact messages.
   */
  private buildContactMessagesWhere(
    query: GetContactMessagesQueryDto,
  ): Prisma.ContactMessageWhereInput {
    const where: Prisma.ContactMessageWhereInput = {
      ...buildDateFilter(query),
      ...buildExactFilter('status', query.status),
    };

    if (query.search?.trim()) {
      const search = query.search.trim();

      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { message: { contains: search, mode: 'insensitive' } },
        { adminReply: { contains: search, mode: 'insensitive' } },
        {
          user: {
            is: {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    return where;
  }

  /**
   * Adds or merges a createdAt >= filter.
   */
  private mergeCreatedAtGte(
    where: Prisma.ContactMessageWhereInput,
    gte: Date,
  ): Prisma.ContactMessageWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' && where.createdAt !== null
        ? where.createdAt
        : {};

    return {
      ...where,
      createdAt: {
        ...existingCreatedAt,
        gte,
      },
    };
  }

  /**
   * Retrieves contact messages with pagination, filtering, searching, and sorting.
   */
  async getContactMessages(query: GetContactMessagesQueryDto) {
    const { page, limit, skip } = buildPagination(query);
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
        take: limit,
        orderBy,
        select: {
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
        },
      }),
      this.prisma.contactMessage.count({ where }),
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
   * Retrieves summary statistics for contact messages.
   */
  async getContactMessagesSummary(query: GetContactMessagesQueryDto) {
    const where = this.buildContactMessagesWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

    const [
      totalMessages,
      todayMessages,
      thisMonthMessages,
      newMessages,
      inProgressMessages,
      repliedMessages,
      closedMessages,
    ] = await Promise.all([
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.count({ where: todayWhere }),
      this.prisma.contactMessage.count({ where: monthWhere }),
      this.prisma.contactMessage.count({
        where: {
          ...where,
          status: ContactMessageStatus.NEW,
        },
      }),
      this.prisma.contactMessage.count({
        where: {
          ...where,
          status: ContactMessageStatus.IN_PROGRESS,
        },
      }),
      this.prisma.contactMessage.count({
        where: {
          ...where,
          status: ContactMessageStatus.REPLIED,
        },
      }),
      this.prisma.contactMessage.count({
        where: {
          ...where,
          status: ContactMessageStatus.CLOSED,
        },
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
   * Retrieves chart-ready analytics grouped by contact message status.
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
   * Exports filtered contact messages as CSV.
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
      select: {
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
      },
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
   * Updates a contact message status and/or admin reply.
   */
  async updateContactMessage(
    id: string,
    body: UpdateContactMessageDto,
    adminId: string,
  ) {
    const contactMessage = await this.prisma.contactMessage.findUnique({
      where: { id },
    });

    if (!contactMessage) {
      throw new NotFoundException('Contact message not found');
    }

    const nextStatus = buildContactMessageStatus(
      contactMessage.status,
      body.status,
      body.adminReply,
    );

    const hasChanges =
      nextStatus !== contactMessage.status ||
      (body.adminReply !== undefined &&
        body.adminReply !== contactMessage.adminReply);

    if (!hasChanges) {
      return {
        message: 'No changes detected',
        contactMessage,
        updated: false,
      };
    }

    const updatedContactMessage =
      await this.prisma.contactMessage.update({
        where: { id },
        data: {
          status: nextStatus,
          adminReply: body.adminReply ?? contactMessage.adminReply,
        },
        select: {
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
        },
      });

    if (body.adminReply?.trim()) {
      await this.mailService.sendContactReplyEmail(
        updatedContactMessage.email,
        updatedContactMessage.fullName,
        updatedContactMessage.subject,
        updatedContactMessage.adminReply ?? '',
      );
    }

    await this.auditLogsService.createLog({
      actorId: adminId,
      action: AuditAction.ADMIN_UPDATE_CONTACT_MESSAGE,
      targetType: AuditTargetType.CONTACT_MESSAGE,
      targetId: id,
      oldValue: {
        status: contactMessage.status,
        adminReply: contactMessage.adminReply,
      },
      newValue: {
        status: updatedContactMessage.status,
        adminReply: updatedContactMessage.adminReply,
      },
    });

    return {
      message: 'Contact message updated successfully',
      contactMessage: updatedContactMessage,
      updated: true,
    };
  }
}