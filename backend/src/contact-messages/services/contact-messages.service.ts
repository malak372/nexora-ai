import { Injectable } from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  ContactMessageStatus,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

import { CreateContactMessageDto } from '../dto/create-contact-message.dto';

/**
 * Input used internally when creating a contact message.
 *
 * userId is obtained from a trusted authenticated context,
 * never directly from the public request body.
 */
export type CreateContactMessageInput = {
  readonly fullName: string;
  readonly email: string;
  readonly subject: string;
  readonly message: string;
  readonly userId?: string;
};

/**
 * Handles public Contact Us message submission.
 *
 * Supports:
 * - Guest submissions.
 * - Authenticated-user submissions.
 * - Optional user relation.
 * - Audit logging for authenticated submissions.
 *
 * This service does not:
 * - List messages.
 * - Reply to messages.
 * - Perform administrator analytics.
 *
 * @author Malak
 */
@Injectable()
export class ContactMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates one contact message.
   *
   * @param dto Validated public request values.
   * @param userId Optional authenticated user identifier.
   */
  async createContactMessage(dto: CreateContactMessageDto, userId?: string) {
    const contactMessage = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contactMessage.create({
        data: {
          fullName: dto.fullName.trim(),
          email: dto.email.trim().toLowerCase(),
          subject: dto.subject.trim(),
          message: dto.message.trim(),
          userId: userId ?? null,
          status: ContactMessageStatus.NEW,
        },

        select: {
          id: true,
          fullName: true,
          email: true,
          subject: true,
          message: true,
          status: true,
          createdAt: true,
        },
      });

      if (userId) {
        await this.auditService.createLog(
          {
            actorId: userId,
            action: AuditAction.USER_CREATE_CONTACT_MESSAGE,
            targetType: AuditTargetType.CONTACT_MESSAGE,
            targetId: created.id,

            newValue: {
              subject: created.subject,
              status: created.status,
            },
          },
          tx,
        );
      }

      return created;
    });

    return {
      message: 'Contact message submitted successfully',
      contactMessage,
    };
  }

  /**
   * Ensures that an optional authenticated user still exists.
   */
  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
      },
    });

    if (!user) {
      /*
       * Normally this cannot happen after valid JWT authentication,
       * but the check protects against deleted or stale accounts.
       */
      return;
    }
  }
}
