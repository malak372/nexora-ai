import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { GetContactMessagesQueryDto } from '../dto/get-contact-messages-query.dto';
import { UpdateContactMessageDto } from '../dto/update-contact-message.dto';

import { AdminContactMessagesService } from '../services/admin-contact-messages.service';

/**
 * Administrator-only contact-message controller.
 *
 * Base route:
 * /admin/contact-messages
 *
 * @author Malak
 */
@Controller('admin/contact-messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminContactMessagesController {
  constructor(
    private readonly adminContactMessagesService: AdminContactMessagesService,
  ) {}

  /**
   * Returns contact messages.
   *
   * GET /admin/contact-messages
   */
  @Get()
  getContactMessages(@Query() query: GetContactMessagesQueryDto) {
    return this.adminContactMessagesService.getContactMessages(query);
  }

  /**
   * Returns contact-message summary statistics.
   *
   * GET /admin/contact-messages/summary
   */
  @Get('summary')
  getContactMessagesSummary(@Query() query: GetContactMessagesQueryDto) {
    return this.adminContactMessagesService.getContactMessagesSummary(query);
  }

  /**
   * Returns chart-ready contact-message analytics.
   *
   * GET /admin/contact-messages/charts
   */
  @Get('charts')
  getContactMessagesCharts(@Query() query: GetContactMessagesQueryDto) {
    return this.adminContactMessagesService.getContactMessagesCharts(query);
  }

  /**
   * Exports filtered contact messages as CSV.
   *
   * GET /admin/contact-messages/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="contact-messages.csv"')
  exportContactMessagesCsv(@Query() query: GetContactMessagesQueryDto) {
    return this.adminContactMessagesService.exportContactMessagesCsv(query);
  }

  /**
   * Updates one contact message.
   *
   * PATCH /admin/contact-messages/:id
   */
  @Patch(':id')
  updateContactMessage(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    contactMessageId: string,

    @Body() body: UpdateContactMessageDto,

    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminContactMessagesService.updateContactMessage(
      contactMessageId,
      body,
      admin.id,
    );
  }
}
