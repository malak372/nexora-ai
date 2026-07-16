import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  ContactMessageStatus,
} from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

import { CreateContactMessageDto } from '../dto/create-contact-message.dto';

/**
 * Normalized sender information used internally when creating
 * a Contact Us message.
 */
type ContactMessageSender = {
  readonly fullName: string;
  readonly email: string;
  readonly userId: string | null;
};

/**
 * Handles Contact Us message submission.
 *
 * Supports:
 * - Public guest submissions.
 * - Authenticated-user submissions.
 * - Optional user relation.
 * - Audit logging for authenticated submissions.
 *
 * Security rules:
 * - userId is accepted only from the authenticated request context.
 * - Authenticated-user name and email are loaded from the database.
 * - Request-body identity fields cannot impersonate another user.
 * - Inactive and soft-deleted users cannot create linked messages.
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
   * Creates one Contact Us message.
   *
   * For guest submissions, identity fields are taken from the
   * validated request DTO.
   *
   * For authenticated submissions, identity fields are loaded from
   * the verified user account instead of trusting the request body.
   *
   * Message creation and audit logging are executed inside one
   * Prisma transaction.
   *
   * @param dto Validated contact-message values.
   * @param userId Optional authenticated user identifier.
   */
  async createContactMessage(
    dto: CreateContactMessageDto,
    userId?: string,
  ) {
    const sender = await this.resolveSender(dto, userId);

    const contactMessage = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.contactMessage.create({
          data: {
            fullName: sender.fullName,
            email: sender.email,
            subject: dto.subject,
            message: dto.message,
            userId: sender.userId,
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

        if (sender.userId) {
          await this.auditService.createLog(
            {
              actorId: sender.userId,
              action:
                AuditAction.USER_CREATE_CONTACT_MESSAGE,
              targetType:
                AuditTargetType.CONTACT_MESSAGE,
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
      },
    );

    return {
      message: 'Contact message submitted successfully',
      contactMessage,
    };
  }

  /**
   * Resolves the trusted sender information.
   *
   * Guest submissions use the normalized DTO values.
   * Authenticated submissions use the persisted account values.
   *
   * @param dto Validated contact-message input.
   * @param userId Optional authenticated user identifier.
   */
  private async resolveSender(
    dto: CreateContactMessageDto,
    userId?: string,
  ): Promise<ContactMessageSender> {
    if (!userId) {
      return {
        fullName: dto.fullName,
        email: dto.email,
        userId: null,
      };
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        'Active user account not found',
      );
    }

    return {
      fullName: user.fullName,
      email: user.email.toLowerCase(),
      userId: user.id,
    };
  }
}

