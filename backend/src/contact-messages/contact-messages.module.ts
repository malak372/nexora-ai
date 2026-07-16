import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminContactMessagesController } from './controllers/admin-contact-messages.controller';
import { ContactMessagesController } from './controllers/contact-messages.controller';
import { UserContactMessagesController } from './controllers/user-contact-messages.controller';

import { AdminContactMessagesService } from './services/admin-contact-messages.service';
import { ContactMessagesService } from './services/contact-messages.service';

/**
 * Shared contact-messages domain module.
 *
 * Provides:
 * - Public guest Contact Us submissions.
 * - Authenticated-user Contact Us submissions.
 * - Administrator message management.
 * - Summary statistics and analytics.
 * - CSV export.
 * - Email replies.
 * - Audit logging.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule, MailModule],
  controllers: [
    ContactMessagesController,
    UserContactMessagesController,
    AdminContactMessagesController,
  ],
  providers: [ContactMessagesService, AdminContactMessagesService],
})
export class ContactMessagesModule {}
