import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditTargetType,
  ContactMessageStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit-logs/audit-logs.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

/**
 * Service responsible for handling Contact Us messages.
 *
 * Supports:
 * - Creating contact messages from guests.
 * - Creating contact messages from authenticated users.
 * - Storing messages for admin review.
 * - Writing audit logs when userId is available.
 *
 * @author Malak
 */
@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditService,
  ) {}

  /**
   * Creates a new Contact Us message.
   */
  async createContactMessage(body: CreateContactMessageDto) {
    const contactMessage = await this.prisma.contactMessage.create({
      data: {
        fullName: body.fullName.trim(),
        email: body.email.trim().toLowerCase(),
        subject: body.subject.trim(),
        message: body.message.trim(),
        userId: body.userId ?? null,
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

    if (body.userId) {
      await this.auditLogsService.createLog({
        actorId: body.userId,
        action: AuditAction.USER_CREATE_CONTACT_MESSAGE,
        targetType: AuditTargetType.CONTACT_MESSAGE,
        targetId: contactMessage.id,
        oldValue: null,
        newValue: {
          subject: contactMessage.subject,
          status: contactMessage.status,
        },
      });
    }

    return {
      message: 'Contact message submitted successfully',
      contactMessage,
    };
  }
}
