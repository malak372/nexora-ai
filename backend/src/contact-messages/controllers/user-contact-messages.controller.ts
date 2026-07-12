import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { CreateContactMessageDto } from '../dto/create-contact-message.dto';

import { ContactMessagesService } from '../services/contact-messages.service';

/**
 * Authenticated-user contact-message controller.
 *
 * Base route:
 * /users/contact-messages
 *
 * @author Malak
 */
@Controller('users/contact-messages')
@UseGuards(JwtAuthGuard)
export class UserContactMessagesController {
  constructor(
    private readonly contactMessagesService:
      ContactMessagesService,
  ) {}

  /**
   * Creates a contact message linked to the authenticated user.
   *
   * POST /users/contact-messages
   */
  @Post()
  createContactMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateContactMessageDto,
  ) {
    return this.contactMessagesService.createContactMessage(
      body,
      user.id,
    );
  }
}