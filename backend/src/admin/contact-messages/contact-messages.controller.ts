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

import { ContactMessagesService } from './contact-messages.service';

import { GetContactMessagesQueryDto } from './dto/get-contact-messages-query.dto';
import { UpdateContactMessageDto } from './dto/update-contact-message.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Authenticated admin payload.
 */
type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for managing contact messages
 * submitted through the Contact Us page.
 *
 * Provides admin-only endpoints for:
 * - Viewing contact messages.
 * - Filtering, searching, sorting, and paginating messages.
 * - Viewing summary statistics.
 * - Viewing chart-ready analytics.
 * - Exporting messages as CSV.
 * - Updating message status and admin reply.
 *
 * Base route:
 * /admin/contact-messages
 *
 * @author Malak
 */
@Controller('admin/contact-messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ContactMessagesController {
  constructor(
    private readonly contactMessagesService: ContactMessagesService,
  ) {}

  /**
   * Retrieves contact messages.
   *
   * Endpoint:
   * GET /admin/contact-messages
   */
  @Get()
  getContactMessages(
    @Query() query: GetContactMessagesQueryDto,
  ) {
    return this.contactMessagesService.getContactMessages(query);
  }

  /**
   * Retrieves contact message summary statistics.
   *
   * Endpoint:
   * GET /admin/contact-messages/summary
   */
  @Get('summary')
  getContactMessagesSummary(
    @Query() query: GetContactMessagesQueryDto,
  ) {
    return this.contactMessagesService.getContactMessagesSummary(
      query,
    );
  }

  /**
   * Retrieves chart-ready contact message analytics.
   *
   * Endpoint:
   * GET /admin/contact-messages/charts
   */
  @Get('charts')
  getContactMessagesCharts(
    @Query() query: GetContactMessagesQueryDto,
  ) {
    return this.contactMessagesService.getContactMessagesCharts(
      query,
    );
  }

  /**
   * Exports filtered contact messages as CSV.
   *
   * Endpoint:
   * GET /admin/contact-messages/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header(
    'Content-Disposition',
    'attachment; filename="contact-messages.csv"',
  )
  exportContactMessagesCsv(
    @Query() query: GetContactMessagesQueryDto,
  ) {
    return this.contactMessagesService.exportContactMessagesCsv(
      query,
    );
  }

  /**
   * Updates an existing contact message.
   *
   * Allows administrators to:
   * - Update the message status.
   * - Add or edit the administrative reply.
   *
   * Endpoint:
   * PATCH /admin/contact-messages/:id
   */
  @Patch(':id')
  updateContactMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateContactMessageDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.contactMessagesService.updateContactMessage(
      id,
      body,
      currentUser.id,
    );
  }
}